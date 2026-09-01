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
    bevel(body, width=0.085, segments=3)
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
            cutters.append(apply(sphere(PIP_R, pos, 14, 8), dark))
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
    body = cylinder(R, T * 2, verts=40)
    bevel(body, width=0.016, segments=2)
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

    body = apply(cylinder(R, T * 2, verts=36), body_mat)
    bevel(body, width=0.012, segments=2)
    smooth(body)

    # Edge spots and a centre inlay: the two features that separate a clay chip
    # from a checker. Both are proud of the body so they catch their own light.
    spots = []
    for k in range(8):
        a = lib.TAU * k / 8
        s = annular_sector(R * 0.90, R * 1.004, a - 0.16, a + 0.16, -T * 0.62, T * 0.62,
                           steps=2, name=f"{tag}_spot{k}")
        spots.append(apply(s, trim_mat))

    inlays = [apply(cylinder(R * 0.60, 0.008, verts=28, location=(0, 0, z)), trim_mat)
              for z in (T + 0.002, -T - 0.002)]
    rings = [apply(torus(R * 0.72, 0.008, location=(0, 0, z), major_seg=28, minor_seg=5), trim_mat)
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
    ], segments=44, name="bowl")
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
    ], segments=44, name="rotor_base"), gold)
    parts.append(base)

    for i, number in enumerate(WHEEL):
        a0 = i * step - step / 2
        a1 = a0 + step
        colour = green if number == 0 else (red if number in REDS else black)
        floor_ = annular_sector(R_POCKET_I, R_POCKET_O, a0 + 0.012, a1 - 0.012,
                                0.010, 0.014, steps=2, name=f"p{number}")
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
    ], segments=32, name="turret"), gold)
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
        a = apply(sphere(0.30, (-0.26, 0, -0.26), 18, 11), skin)
        b = apply(sphere(0.245, (0.28, 0.04, -0.34), 18, 11), skin)
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
        ], segments=28, name="bell"), gold())
        loop = apply(torus(0.062, 0.020, location=(0, 0, 0.700), rotation=(math.pi / 2, 0, 0),
                           major_seg=32, minor_seg=10), gold())
        clapper = apply(sphere(0.10, (0, 0, -0.16), 14, 9), brass())
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
        cranium = sphere(0.44, (0, 0, 0.10), 20, 12)
        cranium.scale = (1.0, 0.92, 1.06)
        apply(cranium, bone)
        cranium.data.materials.append(dark)

        jaw = cube(size=1, location=(0, -0.03, -0.36), scale=(0.52, 0.60, 0.30))
        bevel(jaw, width=0.09, segments=4)
        smooth(jaw)
        apply(jaw, bone)

        # Sockets and nose are drilled with the same material-transfer trick as
        # the dice pips, so they are real hollows rather than dark decals.
        cutters = [apply(sphere(0.155, (x, -0.36, 0.11), 14, 9), dark) for x in (-0.175, 0.175)]
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
            nails.append(apply(sphere(0.038, (math.cos(a) * 0.44, math.sin(a) * 0.44, 0.055), 10, 7),
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

    body = sphere(0.50, (0, -0.04, -0.06), 18, 11)
    body.scale = (0.80, 1.00, 0.74)
    apply(body, yellow)

    breast = sphere(0.30, (0, 0.26, 0.02), 16, 10)
    breast.scale = (0.86, 0.90, 1.05)
    apply(breast, yellow)

    # A visible neck is the whole difference between a duck and a snowman.
    neck = apply(lathe([(0.0, 0.40), (0.135, 0.375), (0.155, 0.20),
                        (0.205, 0.04), (0.24, -0.06), (0.0, -0.08)],
                       segments=18, name="neck"), yellow)
    neck.location = (0, 0.20, 0.20)

    head = sphere(0.255, (0, 0.235, 0.60), 18, 11)
    head.scale = (0.96, 1.02, 1.00)
    apply(head, yellow)

    beak = apply(lathe([(0.0, 0.0), (0.105, 0.015), (0.135, 0.075),
                        (0.115, 0.155), (0.055, 0.205), (0.0, 0.210)],
                       segments=14, name="beak"), orange)
    beak.rotation_euler = (math.radians(84), 0, 0)
    beak.location = (0, 0.44, 0.575)
    beak.scale = (1.0, 1.0, 0.62)

    tail = cube(size=1, location=(0, -0.52, 0.10), rotation=(math.radians(34), 0, 0),
                scale=(0.17, 0.30, 0.10))
    bevel(tail, width=0.045, segments=3)
    smooth(tail)
    apply(tail, yellow)

    eyes = [apply(sphere(0.040, (x, 0.395, 0.655), 12, 8), eye) for x in (-0.140, 0.140)]
    wings = []
    for sx in (-1, 1):
        w = sphere(0.26, (sx * 0.335, -0.06, -0.02), 16, 10)
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

    body = cylinder(0.50, 0.86, verts=32)
    bevel(body, width=0.035, segments=4)
    smooth(body)
    apply(body, steel)
    body.data.materials.append(dark)

    # Six bored chambers and six flutes between them: the flutes are what make a
    # revolver cylinder read as a revolver cylinder rather than as a spool.
    bores, flutes = [], []
    for k in range(6):
        a = lib.TAU * k / 6
        bores.append(apply(cylinder(0.135, 1.0, verts=16,
                                    location=(math.cos(a) * 0.30, math.sin(a) * 0.30, 0)), dark))
        fa = a + lib.TAU / 12
        f = cylinder(0.115, 0.68, verts=16,
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

"""The people, in four pieces.

   These are not humans. The game this follows draws everyone -- you included --
   as a bowling pin about two heads tall: a wide oval head sat on a tapered,
   footless teardrop body with no legs at all, two enormous eyes that take up
   most of the face under one thick brow bar, and a pair of mitten hands that
   float unattached beside the body. That is the single most recognisable thing
   about it, and an earlier pass here modelled realistic adults in suits, which
   looked fine and belonged to a different game.

   So: `pin_body`, `pin_head`, `pin_hand`, and a few hats. The hands are one
   mesh used twice and are symmetric about the body's centre plane, so no
   negative scale is needed to mirror one -- that would reverse the winding and
   turn it inside out.

   The body is a single loft rather than a stack of spheres. A pin is one
   continuous curve from the floor to the neck; built from ellipsoids it comes
   out as a snowman, because every overlap is a bulge.

   Height is 1.52 m, not the ~1.2 m two heads would give. The rooms here are
   built around a 1.62 m eye, and a character short enough to be strictly
   correct stands in them looking like a child who wandered in.
"""

PIN = {
    "height": 1.52,
    "neck": 0.905,       # where the head sits, above the floor
    "hand": 0.560,       # resting height of the floating hands
    "handX": 0.410,      # how far out to the side they hover
    "brow": 1.265,       # the brow bar, for anything that wants to aim at a face
}


def _pin_mats():
    return {
        # The one flat pastel the whole body is painted in; the game tints this
        # per person, so what is authored here is only a mid-tone to tint from.
        "body": mat("pin_body", (0.62, 0.60, 0.58), roughness=0.72),
        "white": mat("pin_eye_white", (0.92, 0.91, 0.89), roughness=0.24, clearcoat=0.6),
        "dark": mat("pin_eye_dark", (0.030, 0.028, 0.032), roughness=0.20, clearcoat=0.7),
        "mouth": mat("pin_mouth", (0.55, 0.15, 0.20), roughness=0.45),
        "felt": mat("pin_felt", (0.10, 0.09, 0.11), roughness=0.85),
        "gold": mat("pin_gold", (0.72, 0.54, 0.20), metallic=1.0, roughness=0.26),
    }


@model
def pin_body():
    reset()
    m = _pin_mats()
    # Floor to neck. Widest low down, which is what makes it a pin rather than
    # a cone, and rounded off at the bottom because it has no feet to stand on.
    body = loft([
        (0.000, 0.148, 0.148),
        (0.018, 0.203, 0.203),
        (0.058, 0.260, 0.258),
        (0.138, 0.301, 0.297),
        (0.250, 0.312, 0.308),
        (0.380, 0.298, 0.294),
        (0.520, 0.262, 0.258),
        (0.650, 0.223, 0.221),
        (0.762, 0.198, 0.197),
        (0.855, 0.184, 0.185),
        (0.905, 0.178, 0.180),
    ], segments=28, name="pin")
    parts = [apply(body, m["body"])]
    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("pin_body", parts)
    PACK.meta["pin"] = dict(PIN)


@model
def pin_head():
    reset()
    m = _pin_mats()
    parts = []

    # A wide oval, authored from its underside so the game can sit it on the
    # neck and turn it there.
    skull = loft([
        (0.000, 0.146, 0.138),
        (0.028, 0.216, 0.198),
        (0.086, 0.275, 0.248),
        (0.166, 0.299, 0.267),
        (0.258, 0.295, 0.263),
        (0.356, 0.261, 0.235),
        (0.436, 0.190, 0.172),
        (0.488, 0.092, 0.084),
        (0.508, 0.000, 0.000),
    ], segments=24, name="skull")
    parts.append(apply(skull, m["body"]))

    for sx in (-1, 1):
        # Enormous, and proud of the face rather than set into it -- they are
        # most of the head, and a socket would hide the thing that carries the
        # whole expression.
        white = sphere(0.116, (sx * 0.120, 0.126, 0.262), 20, 12)
        white.scale = (1.0, 0.86, 1.06)
        parts.append(apply(white, m["white"]))
        pupil = sphere(0.058, (sx * 0.120, 0.212, 0.256), 14, 9)
        pupil.scale = (1.0, 0.72, 1.10)
        parts.append(apply(pupil, m["dark"]))

    # One thick brow bar across both eyes, which is the whole eyebrow.
    brow = cube(size=1, location=(0, 0.182, 0.350),
                rotation=(math.radians(-10), 0, 0), scale=(0.395, 0.058, 0.054))
    bevel(brow, width=0.018, segments=3)
    parts.append(apply(brow, m["dark"]))

    mouth = sphere(1.0, (0, 0.236, 0.132), 14, 9)
    mouth.scale = (0.052, 0.030, 0.036)
    parts.append(apply(mouth, m["mouth"]))

    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("pin_head", parts)


@model
def pin_hand():
    reset()
    m = _pin_mats()
    # A mitten: one fat palm with three finger lobes over the top and a thumb
    # off the side. Authored around its own centre, because it floats -- there
    # is no wrist for it to hinge on.
    palm = sphere(1.0, (0, 0, 0), 16, 10)
    palm.scale = (0.104, 0.074, 0.116)
    parts = [apply(palm, m["body"])]
    for i, x in enumerate((-0.046, 0.0, 0.046)):
        lobe = sphere(1.0, (x * 1.18, 0.010, 0.102 - abs(x) * 0.24), 12, 8)
        lobe.scale = (0.036, 0.048, 0.058)
        parts.append(apply(lobe, m["body"]))
    thumb = sphere(1.0, (0.096, 0.004, -0.008), 12, 8)
    thumb.scale = (0.048, 0.043, 0.062)
    parts.append(apply(thumb, m["body"]))
    for o in parts:
        smooth(o)
    rig_yup(parts, (0, 0, 0))
    PACK.add("pin_hand", parts)


@model
def pin_hats():
    """Three hats and a monocle, authored to sit on the crown of a head.

    The game leans hard on cosmetics -- fez, top hat, boater, monocle, bow ties
    -- and four identical pastel pins in a room read as one character repeated.
    Each of these is its own mesh so the game can hand a different one to each
    friend and leave somebody bare-headed."""
    for name, build in (("pin_hat_top", _hat_top), ("pin_hat_fez", _hat_fez),
                        ("pin_hat_boater", _hat_boater), ("pin_monocle", _monocle)):
        reset()
        m = _pin_mats()
        parts = build(m)
        for o in parts:
            smooth(o)
        rig_yup(parts, (0, 0, 0))
        PACK.add(name, parts)


def _hat_top(m):
    brim = cylinder(0.250, 0.022, verts=40, location=(0, 0, 0.011))
    bevel(brim, width=0.008, segments=2)
    crown = cylinder(0.163, 0.250, verts=40, location=(0, 0, 0.147))
    band = cylinder(0.170, 0.048, verts=40, location=(0, 0, 0.052))
    return [apply(brim, m["felt"]), apply(crown, m["felt"]), apply(band, m["gold"])]


def _hat_fez(m):
    body = cone(0.150, 0.128, 0.190, verts=32, location=(0, 0, 0.095))
    top = cylinder(0.128, 0.014, verts=32, location=(0, 0, 0.197))
    # The tassel, which is the only reason anyone recognises a fez.
    cord = cylinder(0.010, 0.150, verts=10, location=(0.070, 0, 0.150))
    cord.rotation_euler = (0, math.radians(24), 0)
    knot = sphere(0.026, (0.105, 0, 0.082), 14, 10)
    return [apply(body, m["mouth"]), apply(top, m["mouth"]),
            apply(cord, m["gold"]), apply(knot, m["gold"])]


def _hat_boater(m):
    brim = cylinder(0.268, 0.018, verts=40, location=(0, 0, 0.009))
    bevel(brim, width=0.010, segments=2)
    crown = cylinder(0.170, 0.092, verts=40, location=(0, 0, 0.064))
    band = cylinder(0.176, 0.030, verts=40, location=(0, 0, 0.040))
    return [apply(brim, m["body"]), apply(crown, m["body"]), apply(band, m["mouth"])]


def _monocle(m):
    ring = torus(0.132, 0.015, location=(0, 0, 0), major_seg=32, minor_seg=10)
    chain = cylinder(0.005, 0.105, verts=8, location=(0.126, -0.082, 0))
    chain.rotation_euler = (0, 0, math.radians(-16))
    return [apply(ring, m["gold"]), apply(chain, m["gold"])]


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
