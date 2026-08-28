#!/usr/bin/env python3
"""Build every 3D model the game renders and pack them for the browser.

    python3 gwyf-web/blender/models.py             # all models
    python3 gwyf-web/blender/models.py die coin    # a subset, for iterating

Models are authored at game scale in a right-handed Z-up space and converted to
three.js's Y-up on export, so nothing needs rotating at runtime. A die is one
unit across, a chip half a unit, and so on -- the numbers in the scene code are
then the numbers you would measure off the object.
"""

import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib
from lib import (BRASS, CHROME, CRIMSON, FELT, GOLD, IVORY, JET, apply, bevel, decimate,
                 cone, cube, cylinder, empty, join, lathe, loft, mat, plane, reset,
                 smooth, sphere, star, text, torus, annular_sector)
import exporter

PACK = exporter.Packer()
BUILDERS = {}


def model(fn):
    BUILDERS[fn.__name__] = fn
    return fn


def finalize(objects, fit=None, face=False, spin=0.0, ground=False):
    """Centre, scale and orient a model, then hand it to the packer.

    One rig does all of it. An earlier version centred with one parent and
    rotated with another, which cannot work -- an object has a single parent, so
    the second call silently discarded the first one's scale and half the
    symbols shipped at the wrong size.

    `fit` scales the longest axis to that many units. `face` turns art authored
    flat in Blender's XY plane so it faces the player rather than the ceiling.
    `spin` turns the model about its own vertical first. `ground` puts the
    model's base on y=0 instead of centring it, which is what anything that sits
    on a table wants.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objects:
        if o.type not in {"MESH", "FONT", "CURVE"}:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = o.matrix_world @ v.co
            for a in range(3):
                lo[a] = min(lo[a], w[a])
                hi[a] = max(hi[a], w[a])
        ev.to_mesh_clear()
    span = [hi[a] - lo[a] for a in range(3)]
    k = (fit / max(span + [1e-6])) if fit else 1.0
    centre = mathutils.Vector((
        (lo[0] + hi[0]) / 2,
        (lo[1] + hi[1]) / 2,
        lo[2] if ground else (lo[2] + hi[2]) / 2,
    ))

    # three.js is Y-up. Rotating once here beats a stray -90 degrees on every
    # object in the scene code, where it is the kind of thing that gets
    # forgotten on the one object nobody looked at from the side.
    rot = mathutils.Matrix.Rotation(-math.pi / 2, 4, "X")
    if face:
        rot = rot @ mathutils.Matrix.Rotation(math.pi / 2, 4, "X")
    if spin:
        rot = rot @ mathutils.Matrix.Rotation(math.radians(spin), 4, "Z")

    rig = empty()
    # Everything in the scene rides the rig, not just the objects being exported.
    # Boolean cutters are hidden and never exported, but a modifier resolves its
    # cutter in world space: leave them behind and the rig's rotation slides
    # every cut off its target. That is silent -- the mesh still builds, the
    # holes are simply somewhere else -- and it is how a die ended up with the
    # wrong pips on four of its faces.
    riders = [o for o in bpy.context.scene.objects
              if o is not rig and o.type in {"MESH", "FONT", "CURVE"}]
    lib.parent_to(riders, rig)
    rig.rotation_euler = rot.to_euler()
    rig.scale = (k, k, k)
    rig.location = -(rot.to_3x3() @ (centre * k))
    bpy.context.view_layer.update()
    return objects


def rig_yup(objects, pivot=(0, 0, 0)):
    """Turn Z-up authoring space into three.js Y-up without moving a joint.

    `finalize` centres a model on its own bounding box, which is right for a
    prop and wrong for a limb: an arm centred on its middle swings from its
    elbow. This keeps the chosen point exactly at the origin instead, so the
    game can rotate an arm about the shoulder it was authored around.
    """
    rot = mathutils.Matrix.Rotation(-math.pi / 2, 4, "X")
    rig = empty()
    riders = [o for o in bpy.context.scene.objects
              if o is not rig and o.type in {"MESH", "FONT", "CURVE"}]
    lib.parent_to(riders, rig)
    rig.rotation_euler = rot.to_euler()
    rig.location = -(rot.to_3x3() @ mathutils.Vector(pivot))
    bpy.context.view_layer.update()
    return objects


import bpy  # noqa: E402  (lib must configure the module first)
import mathutils  # noqa: E402


# --- die --------------------------------------------------------------------

H = 0.5                 # half the edge length: the die is one unit across
PIP_OFF = 0.25          # pip centre offset from the face centre
PIP_R = 0.118
PIP_DEPTH = 0.052

PIPS = {
    1: [(0, 0)],
    2: [(-1, 1), (1, -1)],
    3: [(-1, 1), (0, 0), (1, -1)],
    4: [(-1, 1), (1, 1), (-1, -1), (1, -1)],
    5: [(-1, 1), (1, 1), (0, 0), (-1, -1), (1, -1)],
    6: [(-1, 1.12), (-1, 0), (-1, -1.12), (1, 1.12), (1, 0), (1, -1.12)],
}

# Face normal -> (u, v, value). Opposite faces sum to seven, as on a real die;
# a die photographed from a corner shows three faces at once and a wrong one is
# the first thing anybody who has held dice will notice.
FACES = {
    (0, 0, 1): ((1, 0, 0), (0, 1, 0), 1),
    (0, 0, -1): ((1, 0, 0), (0, -1, 0), 6),
    (1, 0, 0): ((0, 1, 0), (0, 0, 1), 3),
    (-1, 0, 0): ((0, -1, 0), (0, 0, 1), 4),
    (0, 1, 0): ((-1, 0, 0), (0, 0, 1), 5),
    (0, -1, 0): ((1, 0, 0), (0, 0, 1), 2),
}


@model
def die():
    reset()
    body = cube(size=H * 2)
    bevel(body, width=0.085, segments=6)
    smooth(body)
    apply(body, IVORY())

    # Drill the pips and let the boolean carry the dark material into the hole.
    # Filling each dimple with a second, smaller sphere is the obvious approach
    # and it is wrong: a sphere centred on the surface has half its volume above
    # it, so the pips come out as beads glued on rather than drilled.
    dark = JET()
    body.data.materials.append(dark)
    cutters = []
    for n, (u, v, value) in FACES.items():
        for x, y in PIPS[value]:
            out = H + (PIP_R - PIP_DEPTH)
            pos = tuple(n[i] * out + u[i] * x * PIP_OFF + v[i] * y * PIP_OFF for i in range(3))
            cutters.append(apply(sphere(PIP_R, pos, 28, 14), dark))
    cutter = join(cutters)
    cutter.hide_render = True
    m = body.modifiers.new("pips", "BOOLEAN")
    m.operation, m.object, m.solver = "DIFFERENCE", cutter, "EXACT"
    m.material_mode = "TRANSFER"

    finalize([body])
    PACK.add("die", [body])
    # Which value ends up pointing which way once the model is in three.js
    # space. Working this out again by hand in the game code is how a die
    # settles on a five and the game pays for a two.
    PACK.meta["die"] = {
        "faces": [{"value": v, "normal": [n[0], n[2], -n[1]]}
                  for n, (_, _, v) in FACES.items()],
        "size": H * 2,
    }


# --- coin -------------------------------------------------------------------

@model
def coin():
    reset()
    R, T = 0.5, 0.076
    body = cylinder(R, T * 2, verts=112)
    bevel(body, width=0.016, segments=4)
    smooth(body)
    apply(body, GOLD())

    # Reeded edge: real coins are milled, so the rim reads as a ring of
    # highlights instead of the smooth band that makes a cylinder look plastic.
    brass = BRASS()
    reeds = [apply(cube(size=1,
                        location=(math.cos(a) * R * 0.99, math.sin(a) * R * 0.99, 0),
                        rotation=(0, 0, a),
                        scale=(0.012, 0.013, T * 1.5)), brass)
             for a in (lib.TAU * k / 76 for k in range(76))]

    heads = apply(star(5, outer=0.29, inner=0.125, depth=0.03,
                       location=(0, 0, T + 0.004)), brass)
    tails = [apply(cube(size=1, location=(0, 0, -T - 0.006),
                        rotation=(0, 0, math.radians(s)), scale=(0.52, 0.10, 0.028)), brass)
             for s in (45, -45)]

    parts = [body, heads, *reeds, *tails]
    finalize(parts)
    PACK.add("coin", parts)


# --- chip -------------------------------------------------------------------

# Linear-space values, not sRGB swatches: these reach the shader as linear, and
# an sRGB hex pasted in here renders about a stop and a half too bright.
CHIP_COLOURS = [
    ("chip1", (0.62, 0.60, 0.55), (0.16, 0.045, 0.055)),
    ("chip5", (0.26, 0.022, 0.030), (0.60, 0.57, 0.52)),
    ("chip25", (0.018, 0.135, 0.062), (0.60, 0.57, 0.52)),
    ("chip100", (0.016, 0.015, 0.018), (0.42, 0.30, 0.10)),
    ("chip500", (0.105, 0.030, 0.170), (0.55, 0.50, 0.60)),
]


def _chip(body_col, trim_col, tag):
    R, T = 0.5, 0.055
    body_mat = mat(f"{tag}_body", body_col, roughness=0.52)
    trim_mat = mat(f"{tag}_trim", trim_col, roughness=0.44)

    body = apply(cylinder(R, T * 2, verts=96), body_mat)
    bevel(body, width=0.012, segments=3)
    smooth(body)

    # Edge spots and a centre inlay: the two features that separate a clay chip
    # from a checker. Both are proud of the body so they catch their own light.
    spots = []
    for k in range(8):
        a = lib.TAU * k / 8
        s = annular_sector(R * 0.90, R * 1.004, a - 0.16, a + 0.16, -T * 0.62, T * 0.62,
                           steps=5, name=f"{tag}_spot{k}")
        spots.append(apply(s, trim_mat))

    inlays = [apply(cylinder(R * 0.60, 0.008, verts=72, location=(0, 0, z)), trim_mat)
              for z in (T + 0.002, -T - 0.002)]
    rings = [apply(torus(R * 0.72, 0.008, location=(0, 0, z), major_seg=72, minor_seg=8), trim_mat)
             for z in (T - 0.002, -T + 0.002)]
    return [body, *spots, *inlays, *rings]


@model
def chips():
    for tag, body_col, trim_col in CHIP_COLOURS:
        reset()
        parts = _chip(body_col, trim_col, tag)
        finalize(parts)
        PACK.add(tag, parts)


# --- roulette ---------------------------------------------------------------

# A real European wheel, in wheel order clockwise from zero. The sequence is not
# decorative: it interleaves high/low, odd/even and red/black so that no sector
# of the wheel favours any outside bet, and a made-up order would be visible to
# anyone who has looked at one.
WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
         10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
REDS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

R_OUT = 1.00      # outside of the bowl
R_TRACK = 0.78    # where the ball runs before it drops
R_POCKET_O = 0.62
R_POCKET_I = 0.40
R_TURRET = 0.34


@model
def roulette_bowl():
    reset()
    wood = mat("wood", (0.055, 0.028, 0.020), roughness=0.30, clearcoat=0.7)
    gold = GOLD()

    # The bowl is one lathed profile so the ball track flows into the apron with
    # no seam. Stacking cylinders leaves a visible ring exactly where the ball
    # is meant to run smoothly.
    bowl = lathe([
        (R_OUT, 0.00), (R_OUT, 0.22), (R_OUT - 0.05, 0.24),
        (R_TRACK + 0.06, 0.175), (R_TRACK, 0.150),        # ball track
        (R_TRACK - 0.05, 0.145), (R_POCKET_O + 0.03, 0.055),
        (R_POCKET_O + 0.005, 0.030), (R_POCKET_O + 0.005, 0.000),
        (R_OUT, 0.000),
    ], segments=128, name="bowl")
    apply(bowl, wood)

    rim = apply(torus(R_OUT - 0.012, 0.026, location=(0, 0, 0.232), major_seg=128), gold)
    lip = apply(torus(R_TRACK + 0.005, 0.012, location=(0, 0, 0.152), major_seg=128), gold)

    # Ball deflectors. Every real wheel has them so the ball cannot be aimed;
    # here they are also what makes the drop look unscripted.
    deflectors = []
    for k in range(8):
        a = lib.TAU * k / 8
        d = cube(size=1, location=(math.cos(a) * (R_TRACK - 0.045),
                                   math.sin(a) * (R_TRACK - 0.045), 0.128),
                 rotation=(0, math.radians(28), a), scale=(0.075, 0.030, 0.030))
        deflectors.append(apply(d, gold))

    parts = [bowl, rim, lip, *deflectors]
    finalize(parts, ground=True)
    PACK.add("roulette_bowl", parts)


@model
def roulette_rotor():
    reset()
    gold = GOLD()
    red = mat("wheel_red", (0.28, 0.020, 0.026), roughness=0.28, clearcoat=0.6)
    black = mat("wheel_black", (0.014, 0.013, 0.015), roughness=0.28, clearcoat=0.6)
    green = mat("wheel_green", (0.020, 0.155, 0.070), roughness=0.28, clearcoat=0.6)
    ivory = mat("wheel_number", (0.62, 0.60, 0.56), roughness=0.35)

    n = len(WHEEL)
    step = lib.TAU / n
    parts = []
    pockets = []

    base = apply(lathe([
        (0.0, 0.030), (R_POCKET_I - 0.02, 0.030), (R_POCKET_I, 0.010),
        (R_POCKET_O, 0.010), (R_POCKET_O, 0.052), (R_POCKET_O + 0.004, 0.052),
        (R_POCKET_O + 0.004, -0.020), (0.0, -0.020),
    ], segments=128, name="rotor_base"), gold)
    parts.append(base)

    for i, number in enumerate(WHEEL):
        a0 = i * step - step / 2
        a1 = a0 + step
        colour = green if number == 0 else (red if number in REDS else black)
        floor_ = annular_sector(R_POCKET_I, R_POCKET_O, a0 + 0.012, a1 - 0.012,
                                0.010, 0.014, steps=4, name=f"p{number}")
        parts.append(apply(floor_, colour))
        pockets.append(round(i * step, 6))

        # Frets: the metal dividers. Without them the pockets read as painted
        # stripes and the ball has nothing to rattle off.
        fret = annular_sector(R_POCKET_I - 0.010, R_POCKET_O + 0.004, a0 - 0.0072, a0 + 0.0072,
                              0.010, 0.033, steps=2, name=f"f{i}")
        parts.append(apply(fret, gold))

        t = text(str(number), size=0.062, extrude=0.003,
                 location=(math.cos(i * step) * 0.505, math.sin(i * step) * 0.505, 0.0145),
                 rotation=(0, 0, i * step - math.pi / 2), bold_scale=0.28)
        t.data.resolution_u = 2
        t.data.bevel_depth = 0
        parts.append(apply(t, ivory))

    # The turret: the cone in the middle the croupier spins.
    # Low and waisted, like the handle a croupier actually spins. A tall cone
    # reads as a party hat and hides half the pockets behind it.
    turret = apply(lathe([
        (0.0, 0.205), (0.032, 0.200), (0.062, 0.170), (0.058, 0.140),
        (0.090, 0.112), (0.135, 0.092), (0.120, 0.070), (0.185, 0.056),
        (0.26, 0.042), (R_TURRET, 0.034), (R_TURRET, 0.026), (0.0, 0.026),
    ], segments=96, name="turret"), gold)
    parts.append(turret)
    for k in range(4):
        a = lib.TAU * k / 4 + math.pi / 4
        arm = cube(size=1, location=(math.cos(a) * 0.21, math.sin(a) * 0.21, 0.062),
                   rotation=(0, math.radians(-9), a), scale=(0.32, 0.028, 0.014))
        parts.append(apply(arm, gold))

    finalize(parts, ground=True)
    PACK.add("roulette_rotor", parts)
    PACK.meta["roulette"] = {
        "order": WHEEL,
        "reds": sorted(REDS),
        # Pocket i sits at this angle about the rotor's Y axis, measured from
        # the rotor's own zero mark. The game needs it to park the ball.
        "pocketStep": round(lib.TAU / n, 8),
        "trackRadius": R_TRACK,
        "pocketRadius": round((R_POCKET_I + R_POCKET_O) / 2, 4),
    }


# --- slot symbols -----------------------------------------------------------
#
# Each symbol is authored to fit roughly a unit cube centred on the origin, so
# the reel code can place them on a ring without knowing what any of them are.

def _symbol(name, build, face=False, thin=None):
    reset()
    parts, kw = build(), {}
    if isinstance(parts, tuple):
        parts, kw = parts
    if thin:
        for o in parts:
            if o.type == "MESH":
                decimate(o, thin)
    finalize(parts, fit=1.0, face=face, **kw)
    PACK.add(name, parts)


@model
def symbols():
    gold, brass, jet = GOLD, BRASS, JET

    def seven():
        t = text("7", size=1.0, extrude=0.13, bold_scale=1.6)
        t.data.resolution_u = 5
        return [apply(t, mat("sym_seven", (0.36, 0.020, 0.028), roughness=0.20, clearcoat=0.9))]

    def bar():
        plate = cube(size=1, scale=(1.0, 0.40, 0.15))
        bevel(plate, width=0.035, segments=4)
        smooth(plate)
        apply(plate, gold())
        t = text("BAR", size=0.24, extrude=0.02, location=(0, 0, 0.082), bold_scale=1.0)
        t.data.resolution_u = 4
        return [plate, apply(t, mat("sym_bar_ink", (0.020, 0.014, 0.010), roughness=0.42))]

    def cherry():
        skin = mat("sym_cherry", (0.30, 0.014, 0.030), roughness=0.16, clearcoat=1.0)
        leafm = mat("sym_leaf", (0.045, 0.16, 0.035), roughness=0.42)
        stemm = mat("sym_stem", (0.10, 0.075, 0.030), roughness=0.60)
        a = apply(sphere(0.30, (-0.26, 0, -0.26), 40, 20), skin)
        b = apply(sphere(0.245, (0.28, 0.04, -0.34), 40, 20), skin)
        stems = []
        for (x, y, z), tilt in (((-0.26, 0, -0.26), -20), ((0.28, 0.04, -0.34), 16)):
            st = cylinder(0.020, 0.62, verts=12,
                          location=(x * 0.55, y * 0.5, z + 0.44),
                          rotation=(0, math.radians(tilt), 0))
            stems.append(apply(st, stemm))
        leaf = cube(size=1, location=(0.10, 0, 0.60), rotation=(0, math.radians(24), math.radians(18)),
                    scale=(0.42, 0.02, 0.16))
        bevel(leaf, width=0.03, segments=3)
        smooth(leaf)
        return [a, b, *stems, apply(leaf, leafm)]

    def bell():
        body = apply(lathe([
            (0.000, 0.700), (0.048, 0.694), (0.068, 0.652), (0.054, 0.616),
            (0.104, 0.592), (0.168, 0.556), (0.228, 0.486), (0.268, 0.398),
            (0.294, 0.298), (0.318, 0.186), (0.356, 0.074), (0.412, -0.020),
            (0.454, -0.082), (0.468, -0.120), (0.436, -0.126), (0.398, -0.070),
            (0.348, 0.040), (0.288, 0.196), (0.226, 0.372), (0.150, 0.500),
            (0.000, 0.540),
        ], segments=72, name="bell"), gold())
        loop = apply(torus(0.062, 0.020, location=(0, 0, 0.700), rotation=(math.pi / 2, 0, 0),
                           major_seg=32, minor_seg=10), gold())
        clapper = apply(sphere(0.10, (0, 0, -0.16), 32, 16), brass())
        band = apply(torus(0.462, 0.024, location=(0, 0, -0.108), major_seg=72), brass())
        return [body, loop, clapper, band]

    def diamond():
        gem = mat("sym_gem", (0.13, 0.42, 0.86), roughness=0.02, ior=2.42, transmission=0.90)
        crown = cone(0.50, 0.27, 0.24, location=(0, 0, 0.12), verts=16)
        pavilion = cone(0.50, 0.0, 0.72, location=(0, 0, -0.36), rotation=(math.pi, 0, 0), verts=16)
        girdle = cylinder(0.505, 0.035, verts=16)
        for o in (crown, pavilion, girdle):
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.shade_flat()
            o.select_set(False)
            apply(o, gem)
        return [crown, pavilion, girdle]

    def skull():
        bone = mat("sym_bone", (0.60, 0.575, 0.50), roughness=0.44)
        dark = mat("sym_socket", (0.012, 0.010, 0.010), roughness=0.70)
        cranium = sphere(0.44, (0, 0, 0.10), 48, 26)
        cranium.scale = (1.0, 0.92, 1.06)
        apply(cranium, bone)
        cranium.data.materials.append(dark)

        jaw = cube(size=1, location=(0, -0.03, -0.36), scale=(0.52, 0.60, 0.30))
        bevel(jaw, width=0.09, segments=4)
        smooth(jaw)
        apply(jaw, bone)

        # Sockets and nose are drilled with the same material-transfer trick as
        # the dice pips, so they are real hollows rather than dark decals.
        cutters = [apply(sphere(0.155, (x, -0.36, 0.11), 28, 14), dark) for x in (-0.175, 0.175)]
        nose = apply(cone(0.11, 0.0, 0.30, location=(0, -0.34, -0.10),
                          rotation=(math.radians(-90), 0, 0), verts=3), dark)
        cut = join(cutters + [nose])
        cut.hide_render = True
        m = cranium.modifiers.new("sockets", "BOOLEAN")
        m.operation, m.object, m.solver, m.material_mode = "DIFFERENCE", cut, "EXACT", "TRANSFER"

        teeth = []
        for i in range(6):
            t = cube(size=1, location=(-0.20 + i * 0.08, -0.30, -0.30), scale=(0.055, 0.10, 0.22))
            teeth.append(apply(t, bone))
        return [cranium, jaw, *teeth]

    def horseshoe():
        shoe = torus(0.44, 0.105, major_seg=56, minor_seg=14)
        shoe.scale = (1.0, 1.0, 0.55)
        apply(shoe, gold())
        gap = cube(size=1, location=(0, -0.62, 0), scale=(1.6, 0.72, 0.9))
        gap.hide_render = True
        m = shoe.modifiers.new("gap", "BOOLEAN")
        m.operation, m.object, m.solver = "DIFFERENCE", gap, "EXACT"
        nails = []
        for k in range(6):
            a = math.radians(28 + k * 25)
            nails.append(apply(sphere(0.038, (math.cos(a) * 0.44, math.sin(a) * 0.44, 0.055), 20, 10),
                               BRASS()))
        return [shoe, *nails]

    # `face` is for symbols authored flat in the XY plane: they have to be stood
    # up to look at the player, where the modelled-in-3D ones already do.
    # Fourteen of these stand on each of three reel drums, so they are the
    # heaviest thing in the game by count. The organic ones decimate without
    # anybody noticing; the lettering does not, so it is left alone.
    for name, fn, face, thin in (("sym_seven", seven, True, None),
                                 ("sym_bar", bar, True, None),
                                 ("sym_cherry", cherry, False, 0.34),
                                 ("sym_bell", bell, False, 0.28),
                                 ("sym_diamond", diamond, False, None),
                                 ("sym_skull", skull, False, 0.34),
                                 ("sym_horseshoe", horseshoe, True, 0.32)):
        _symbol(name, fn, face, thin)


# --- duck -------------------------------------------------------------------

@model
def duck():
    reset()
    yellow = mat("duck_body", (0.70, 0.40, 0.028), roughness=0.28, clearcoat=0.85)
    orange = mat("duck_beak", (0.68, 0.19, 0.014), roughness=0.34)
    eye = mat("duck_eye", (0.008, 0.007, 0.007), roughness=0.14, clearcoat=1.0)

    body = sphere(0.50, (0, -0.04, -0.06), 36, 20)
    body.scale = (0.80, 1.00, 0.74)
    apply(body, yellow)

    breast = sphere(0.30, (0, 0.26, 0.02), 36, 20)
    breast.scale = (0.86, 0.90, 1.05)
    apply(breast, yellow)

    # A visible neck is the whole difference between a duck and a snowman.
    neck = apply(lathe([(0.0, 0.40), (0.135, 0.375), (0.155, 0.20),
                        (0.205, 0.04), (0.24, -0.06), (0.0, -0.08)],
                       segments=40, name="neck"), yellow)
    neck.location = (0, 0.20, 0.20)

    head = sphere(0.255, (0, 0.235, 0.60), 40, 22)
    head.scale = (0.96, 1.02, 1.00)
    apply(head, yellow)

    beak = apply(lathe([(0.0, 0.0), (0.105, 0.015), (0.135, 0.075),
                        (0.115, 0.155), (0.055, 0.205), (0.0, 0.210)],
                       segments=28, name="beak"), orange)
    beak.rotation_euler = (math.radians(84), 0, 0)
    beak.location = (0, 0.44, 0.575)
    beak.scale = (1.0, 1.0, 0.62)

    tail = cube(size=1, location=(0, -0.52, 0.10), rotation=(math.radians(34), 0, 0),
                scale=(0.17, 0.30, 0.10))
    bevel(tail, width=0.045, segments=3)
    smooth(tail)
    apply(tail, yellow)

    eyes = [apply(sphere(0.040, (x, 0.395, 0.655), 20, 12), eye) for x in (-0.140, 0.140)]
    wings = []
    for sx in (-1, 1):
        w = sphere(0.26, (sx * 0.335, -0.06, -0.02), 32, 18)
        w.scale = (0.30, 0.92, 0.78)
        wings.append(apply(w, yellow))

    parts = [body, breast, neck, head, beak, tail, *eyes, *wings]
    # Ducks race along +X, so that is the direction one faces by default.
    finalize(parts, fit=1.0, spin=-90)
    PACK.add("duck", parts)


# --- the chamber ------------------------------------------------------------

@model
def revolver_cylinder():
    reset()
    steel = mat("gun_steel", (0.44, 0.455, 0.48), metallic=1.0, roughness=0.26)
    dark = mat("gun_bore", (0.006, 0.006, 0.007), roughness=0.85)

    body = cylinder(0.50, 0.86, verts=72)
    bevel(body, width=0.035, segments=4)
    smooth(body)
    apply(body, steel)
    body.data.materials.append(dark)

    # Six bored chambers and six flutes between them: the flutes are what make a
    # revolver cylinder read as a revolver cylinder rather than as a spool.
    bores, flutes = [], []
    for k in range(6):
        a = lib.TAU * k / 6
        bores.append(apply(cylinder(0.135, 1.0, verts=28,
                                    location=(math.cos(a) * 0.30, math.sin(a) * 0.30, 0)), dark))
        fa = a + lib.TAU / 12
        f = cylinder(0.115, 0.68, verts=28,
                     location=(math.cos(fa) * 0.56, math.sin(fa) * 0.56, 0))
        flutes.append(apply(f, dark))
    cut = join(bores + flutes)
    cut.hide_render = True
    m = body.modifiers.new("bores", "BOOLEAN")
    m.operation, m.object, m.solver, m.material_mode = "DIFFERENCE", cut, "EXACT", "TRANSFER"

    ratchet = apply(cylinder(0.14, 0.10, verts=24, location=(0, 0, 0.44)), steel)
    parts = [body, ratchet]
    finalize(parts)
    PACK.add("revolver_cylinder", parts)
    PACK.meta["chamber"] = {"count": 6}


# --- the friends ------------------------------------------------------------

"""A person, in four pieces.

   The friends are the title of the game and until now they were a ticker feed.
   Putting them in the room means a body that can walk, and a body that can walk
   is one that comes apart at the joints: a torso, a head on the neck, an arm
   from the shoulder and a leg from the hip. Each is authored with its own joint
   at the origin -- see `rig_yup` -- so the game rotates a limb about the point
   it actually turns about, and one arm mesh serves both sides unmirrored,
   because every part is symmetric about the body's centre plane and a negative
   scale would reverse the winding and turn the limb inside out.

   Everything soft is a `loft` through cross-sections rather than a stack of
   spheres. The first pass was spheres and the friends came out as balloon
   animals: every overlap is a bulge, and a chest made of three ellipsoids has
   two waists. One surface through the same waypoints is the same silhouette
   with nothing to catch the light on.

   Proportions are a real 1.78 m adult, because the player's eye is at 1.62 m
   and a character built to a stylised height stands in the same room looking
   like a mistake. Skin, hair, jacket and trousers are tinted per friend in the
   game, so the four are one set of meshes and four palettes.
"""

CREW = {
    "height": 1.78,
    "hip": 0.92,         # hip joint above the carpet
    "neck": 0.585,       # neck joint, above the hip
    "shoulder": 0.515,   # shoulder joint, above the hip
    "shoulderX": 0.155,
    "hipX": 0.088,
    "arm": 0.61,
    "leg": 0.92,
}


def _crew_mats():
    return {
        "skin": mat("crew_skin", (0.62, 0.44, 0.34), roughness=0.60),
        "jacket": mat("crew_jacket", (0.42, 0.42, 0.44), roughness=0.74),
        "shirt": mat("crew_shirt", (0.82, 0.81, 0.78), roughness=0.66),
        "tie": mat("crew_tie", (0.20, 0.05, 0.07), roughness=0.42, clearcoat=0.3),
        "hair": mat("crew_hair", (0.10, 0.075, 0.055), roughness=0.80),
        "trouser": mat("crew_trouser", (0.13, 0.13, 0.15), roughness=0.82),
        "shoe": mat("crew_shoe", (0.035, 0.032, 0.030), roughness=0.32, clearcoat=0.5),
        "eye": mat("crew_eye", (0.020, 0.018, 0.020), roughness=0.12, clearcoat=1.0),
        "white": mat("crew_sclera", (0.84, 0.83, 0.81), roughness=0.18, clearcoat=0.8),
        "mouth": mat("crew_mouth", (0.34, 0.19, 0.17), roughness=0.55),
    }


def _torso():
    reset()
    m = _crew_mats()
    parts = []

    # Hips, waist, ribcage, shoulders, and the slope into the neck. The shoulder
    # line is two sections a few centimetres apart: one gradual taper from chest
    # to neck gives a body with no shoulders to hang the arms off.
    body = loft([
        (-0.078, 0.157, 0.108),
        (-0.040, 0.158, 0.1085),
        (0.000, 0.158, 0.109),
        (0.120, 0.156, 0.106, 0.004),
        (0.240, 0.145, 0.097, 0.006),
        (0.340, 0.164, 0.106, 0.006),
        (0.440, 0.193, 0.118, 0.004),
        (0.500, 0.204, 0.121, 0.000),
        (0.528, 0.203, 0.120, -0.001),
        (0.548, 0.191, 0.114, -0.002),
        (0.566, 0.166, 0.107, -0.003),
        (0.580, 0.130, 0.097, -0.004),
        (0.590, 0.106, 0.087, -0.005),
    ], segments=22, name="torso")
    parts.append(apply(body, m["jacket"]))

    # A collar and a tie, both lofts that follow the chest.
    #
    # The first pass did these as beveled cubes and they read as slabs bolted to
    # a mannequin: a flat box laid on a curved chest stands off it at the edges,
    # and two of them at the shoulders looked like American football padding. A
    # thin cross-section walked down the front lies on the body instead. Lapels
    # went the same way for the same reason and are not coming back -- two flaps
    # on a curved chest read as a bathrobe however carefully they are placed,
    # and a buttoned jacket says suit just as clearly.
    collar = loft([
        (0.566, 0.104, 0.092, -0.004),
        (0.596, 0.088, 0.080, -0.005),
        (0.620, 0.074, 0.070, -0.006),
    ], segments=20, name="collar")
    parts.append(apply(collar, m["shirt"]))

    tie = loft([
        (0.268, 0.000, 0.000, 0.100),
        (0.282, 0.014, 0.007, 0.102),
        (0.380, 0.020, 0.008, 0.112),
        (0.470, 0.021, 0.008, 0.121),
        (0.520, 0.018, 0.008, 0.122),
        (0.545, 0.014, 0.010, 0.118),
        (0.566, 0.011, 0.009, 0.110),
        (0.576, 0.000, 0.000, 0.106),
    ], segments=10, name="tie")
    parts.append(apply(tie, m["tie"]))

    # Two buttons down the front, which is what tells you the jacket is done up.
    for z in (0.215, 0.290):
        b = cylinder(0.011, 0.006, verts=10, location=(0, 0, z), rotation=(math.radians(90), 0, 0))
        b.location.y = 0.107
        parts.append(apply(b, m["shoe"]))

    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("person_torso", parts)


HEAD_DROP = 0.050    # see the bottom of _head


def _head():
    reset()
    m = _crew_mats()
    parts = []

    # Neck, jaw, cheeks, cranium. A head is the one part where the difference
    # between a person and a mannequin is a couple of centimetres of jaw.
    head = loft([
        (-0.060, 0.000, 0.000),
        (-0.045, 0.044, 0.046),
        (0.030, 0.050, 0.052),
        (0.075, 0.054, 0.057, 0.002),
        (0.100, 0.064, 0.071, 0.006),
        (0.135, 0.075, 0.085, 0.008),
        (0.180, 0.085, 0.094, 0.005),
        (0.228, 0.089, 0.096, 0.000),
        (0.272, 0.082, 0.088, -0.005),
        (0.306, 0.058, 0.061, -0.008),
        (0.326, 0.000, 0.000, -0.008),
    ], segments=22, name="head")
    parts.append(apply(head, m["skin"]))

    nose = loft([
        (0.168, 0.000, 0.000, 0.082),
        (0.180, 0.013, 0.011, 0.090),
        (0.205, 0.011, 0.009, 0.093),
        (0.234, 0.006, 0.005, 0.086),
    ], segments=12, name="nose")
    parts.append(apply(nose, m["skin"]))

    for sx in (-1, 1):
        ear = sphere(1.0, (sx * 0.088, -0.004, 0.198), 12, 8)
        ear.scale = (0.012, 0.024, 0.031)
        parts.append(apply(ear, m["skin"]))
        # Set into the head, not stuck on it. The first pass had them 4 mm
        # proud of the socket, which from across a room is a pair of marbles.
        white = sphere(0.0165, (sx * 0.034, 0.073, 0.226), 12, 8)
        white.scale = (1.0, 0.80, 1.0)
        parts.append(apply(white, m["white"]))
        pupil = sphere(0.0092, (sx * 0.034, 0.082, 0.225), 10, 6)
        parts.append(apply(pupil, m["eye"]))
        brow = loft([
            (0.246, 0.000, 0.000, 0.070, sx * 0.014),
            (0.249, 0.006, 0.004, 0.078, sx * 0.028),
            (0.250, 0.006, 0.004, 0.076, sx * 0.044),
            (0.247, 0.000, 0.000, 0.068, sx * 0.056),
        ], segments=8, name="brow")
        parts.append(apply(brow, m["hair"]))

    mouth = sphere(1.0, (0, 0.070, 0.148), 14, 8)
    mouth.scale = (0.024, 0.010, 0.005)
    parts.append(apply(mouth, m["mouth"]))

    # Hair is a second scalp, cut back off the face. A cap dropped on top gives
    # a swimmer; a person needs a hairline, and a hairline is a boolean.
    hair = loft([
        (0.150, 0.000, 0.000, -0.006),
        (0.165, 0.078, 0.086, -0.006),
        (0.200, 0.089, 0.098, -0.006),
        (0.240, 0.093, 0.100, -0.008),
        (0.280, 0.086, 0.092, -0.010),
        (0.312, 0.060, 0.064, -0.012),
        (0.334, 0.000, 0.000, -0.012),
    ], segments=22, name="hair")
    face_cut = cube(size=1, location=(0, 0.150, 0.155), rotation=(math.radians(-12), 0, 0),
                    scale=(0.34, 0.20, 0.20))
    face_cut.hide_render = True
    b = hair.modifiers.new("hairline", "BOOLEAN")
    b.operation, b.object, b.solver = "DIFFERENCE", face_cut, "EXACT"
    parts.append(apply(hair, m["hair"]))

    for o in parts:
        smooth(o)
    # Authored from the chin up, then dropped onto the neck. A neck long enough
    # to model the jaw clear of the collar is a neck too long to look at, and
    # the cutter has to come down with it or the hairline slides up the skull.
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.location.z -= HEAD_DROP
    rig_yup(parts, (0, 0, 0))
    PACK.add("person_head", parts)


def _arm():
    reset()
    m = _crew_mats()
    sleeve = loft([
        (0.048, 0.000, 0.000),
        (0.032, 0.040, 0.041),
        (0.000, 0.056, 0.057),
        (-0.090, 0.056, 0.057),
        (-0.230, 0.047, 0.049),
        (-0.285, 0.045, 0.048),
        (-0.380, 0.042, 0.044),
        (-0.470, 0.036, 0.038),
        (-0.498, 0.034, 0.036),
    ], segments=16, name="sleeve")
    cuff = cylinder(0.038, 0.030, verts=16, location=(0, 0.004, -0.505))
    hand = loft([
        (-0.495, 0.030, 0.026, 0.006),
        (-0.520, 0.036, 0.028, 0.008),
        (-0.560, 0.038, 0.026, 0.010),
        (-0.590, 0.033, 0.021, 0.010),
        (-0.610, 0.000, 0.000, 0.010),
    ], segments=14, name="hand")
    parts = [apply(sleeve, m["jacket"]), apply(cuff, m["shirt"]), apply(hand, m["skin"])]
    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("person_arm", parts)


def _leg():
    reset()
    m = _crew_mats()
    trouser = loft([
        (0.060, 0.000, 0.000),
        (0.040, 0.070, 0.074),
        (-0.040, 0.086, 0.091),
        (-0.200, 0.078, 0.083),
        (-0.390, 0.067, 0.071),
        (-0.445, 0.064, 0.069),
        (-0.530, 0.061, 0.066),
        (-0.620, 0.055, 0.059),
        (-0.780, 0.045, 0.048),
        (-0.865, 0.042, 0.045),
    ], segments=16, name="trouser")
    shoe = cube(size=1, location=(0, 0.052, -0.888), scale=(0.088, 0.260, 0.066))
    bevel(shoe, width=0.024, segments=3)
    heel = cube(size=1, location=(0, -0.048, -0.900), scale=(0.078, 0.070, 0.042))
    bevel(heel, width=0.012, segments=2)
    ankle = sphere(1.0, (0, 0.004, -0.858), 14, 10)
    ankle.scale = (0.043, 0.046, 0.040)
    parts = [apply(trouser, m["trouser"]), apply(shoe, m["shoe"]),
             apply(heel, m["shoe"]), apply(ankle, m["shoe"])]
    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("person_leg", parts)


@model
def person():
    _torso()
    _head()
    _arm()
    _leg()
    # The joints, in metres above the carpet or above the hip. The game places
    # four meshes at these points; deriving them a second time in JavaScript is
    # how a head ends up floating a centimetre off its neck.
    PACK.meta["person"] = dict(CREW)


def main():
    wanted = sys.argv[1:] or list(BUILDERS)
    unknown = [w for w in wanted if w not in BUILDERS]
    if unknown:
        sys.exit(f"unknown model(s): {', '.join(unknown)}. known: {', '.join(BUILDERS)}")
    for name in wanted:
        t = time.time()
        BUILDERS[name]()
        print(f"[{name}] {time.time() - t:.1f}s", flush=True)
    path, size = PACK.write()
    tris = sum(p["tris"] for m in PACK.meshes.values() for p in m["parts"])
    print(f"-> {path}  {size / 1024:.0f} KB binary, {len(PACK.meshes)} meshes, {tris} tris")


if __name__ == "__main__":
    main()
