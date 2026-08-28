"""Location A: the outdoor plaza.

Built from what the reference reflections and defocused backgrounds actually
need, not from a plan of a real venue. The car is at the origin facing +Y.
"""
import bpy, math, random
import env_common as E
import lib_kseg as K

NAME = "ENV_PLAZA"


def build():
    coll = K.new_collection(NAME)

    tarmac = _wet_tarmac()
    concrete = E._mat("PLZ_concrete", (0.072, 0.070, 0.066), 0.64)
    concrete_dark = E._mat("PLZ_concrete_dark", (0.0115, 0.0112, 0.0110), 0.70)
    kerb = E._mat("PLZ_kerb", (0.098, 0.097, 0.093), 0.58)
    glassbld = E._mat("PLZ_glass", (0.055, 0.062, 0.070), 0.10, metallic=0.0, coat=0.5)
    stone = E._mat("PLZ_stone", (0.140, 0.129, 0.110), 0.70)
    darkmetal = E._mat("PLZ_darkmetal", (0.030, 0.030, 0.032), 0.38, metallic=0.8)
    foliage_set = [E._mat("PLZ_foliage_a", (0.026, 0.048, 0.020), 0.80),
                   E._mat("PLZ_foliage_b", (0.038, 0.066, 0.026), 0.78),
                   E._mat("PLZ_foliage_c", (0.018, 0.036, 0.017), 0.82),
                   E._mat("PLZ_foliage_d", (0.050, 0.072, 0.030), 0.76)]
    foliage = foliage_set[0]
    trunk = E._mat("PLZ_trunk", (0.040, 0.034, 0.028), 0.75)
    red = E._mat("PLZ_red", (0.320, 0.030, 0.035), 0.60)
    cone = E._mat("PLZ_cone", (0.420, 0.110, 0.030), 0.62)
    white = E._mat("PLZ_white", (0.300, 0.300, 0.297), 0.62)
    pink = E._mat("PLZ_pink", (0.400, 0.075, 0.180), 0.70)

    E.plane("PLZ_ground", coll, 260, 260, (0, 0, 0), material=tarmac)

    # Painted road markings: they give the wet ground its only real texture in
    # S04 and S05, and they anchor the car in the frame.
    for x in (-6.4, 6.4):
        E.plane("PLZ_line", coll, 0.10, 26, (x, -6, 0.002), material=white)

    # Kerb and paved apron behind the car (S01, S02).
    for sgn in (1, -1):
        E.box(f"PLZ_kerb_far_{sgn}", coll, (70, 0.34, 0.14), (0, sgn * 13.0, 0.07),
              material=kerb)
        E.plane(f"PLZ_apron_far_{sgn}", coll, 34, 9, (0, sgn * 18.5, 0.14),
                material=concrete)
        # Near kerb: the line the spectators stand behind in S01 and S05.
        E.box(f"PLZ_kerb_near_{sgn}", coll, (52, 0.30, 0.125),
              (0, sgn * 7.4, 0.0625), material=kerb)
        E.plane(f"PLZ_apron_near_{sgn}", coll, 26, 3.2, (0, sgn * 9.1, 0.125),
                material=concrete)

    # --- background architecture -------------------------------------------
    # The plaza is dressed on every side. Shots 01/02/16 shoot from in front of
    # the car looking back down -Y, while 04/05/07/08/21 shoot from behind
    # looking up +Y, so anything placed on one side only leaves half the film
    # with an empty horizon.

    def _hall(tag, cx, cy, w, d, h, rot):
        E.box(f"PLZ_{tag}", coll, (w, d, h), (cx, cy, h / 2), rotation=(0, 0, rot),
              material=concrete)
        n = max(int(w // 8.5), 2)
        for i in range(n):
            off = -w / 2 + w / (2 * n) + i * (w / n)
            gx = cx + math.cos(rot) * off + math.sin(rot) * (-d / 2 - 0.25)
            gy = cy + math.sin(rot) * off - math.cos(rot) * (-d / 2 - 0.25)
            E.box(f"PLZ_{tag}_g{i}", coll, (w / n * 0.86, 0.4, h * 0.62),
                  (gx, gy, h * 0.50), rotation=(0, 0, rot), material=glassbld)

    def _classical(tag, cx, cy, w, h, rot, cols):
        E.box(f"PLZ_{tag}", coll, (w, 13, h), (cx, cy, h / 2),
              rotation=(0, 0, rot), material=stone)
        for i in range(cols):
            off = -w / 2 + w / (2 * cols) + i * (w / cols)
            gx = cx + math.cos(rot) * off + math.sin(rot) * (-6.9)
            gy = cy + math.sin(rot) * off - math.cos(rot) * (-6.9)
            E.cyl(f"PLZ_{tag}_c{i}", coll, 0.8, h * 0.74, (gx, gy, h * 0.37),
                  material=stone, verts=12)
        for i in range(2):
            off = -w / 4 + i * (w / 2)
            gx = cx + math.cos(rot) * off + math.sin(rot) * (-7.2)
            gy = cy + math.sin(rot) * off - math.cos(rot) * (-7.2)
            E.box(f"PLZ_{tag}_b{i}", coll, (2.4, 0.2, 6.4), (gx, gy, h * 0.58),
                  rotation=(0, 0, rot), material=red)

    # Behind the car (seen in S01, S02, S16): glazed hall plus a low block.
    _hall("bld_S", 6.0, -30.0, 62, 15, 11.0, 0.0)
    E.box("PLZ_bld_S2", coll, (54, 12, 7.5), (-30.0, -40.0, 3.75), material=concrete)
    # Behind the camera for those shots, i.e. in view from S04/S05/S21.
    _hall("bld_N", -8.0, 30.0, 58, 15, 12.0, 0.0)
    _classical("bld_NW", -34.0, 26.0, 34, 14.0, 0.0, 7)
    # Flanks, for the near-side-on framings.
    _classical("bld_W", -34.0, -6.0, 30, 13.0, math.pi / 2, 6)
    _hall("bld_E", 33.0, 2.0, 46, 14, 10.5, math.pi / 2)

    # --- trees --------------------------------------------------------------
    rng = random.Random(7)
    tree_lines = [(-46, 46, -21.0, 1), (-44, 40, 21.5, 1), (-25.0, -25.0, -14, 0)]
    ti = 0
    for x0, x1, yv, along_x in tree_lines:
        n = 20 if along_x else 11
        for i in range(n):
            if along_x:
                x = x0 + (x1 - x0) * (i / (n - 1)) + rng.uniform(-1.3, 1.3)
                y = yv + rng.uniform(-2.4, 2.4)
            else:
                x = x0 + rng.uniform(-2.4, 2.4)
                y = yv + i * 5.4 + rng.uniform(-1.3, 1.3)
            h = rng.uniform(5.0, 7.2)
            E.cyl(f"PLZ_trunk_{ti}", coll, 0.16, h, (x, y, h / 2),
                  material=trunk, verts=8)
            for k in range(5):
                bpy.ops.mesh.primitive_ico_sphere_add(
                    subdivisions=3, radius=rng.uniform(1.5, 2.3),
                    location=(x + rng.uniform(-0.9, 0.9), y + rng.uniform(-0.9, 0.9),
                              h + rng.uniform(-0.4, 1.1)))
                bpy.ops.object.shade_smooth()
                o = bpy.context.object
                o.name = f"PLZ_leaf_{ti}_{k}"
                for c in list(o.users_collection):
                    c.objects.unlink(o)
                coll.objects.link(o)
                o.data.materials.append(rng.choice(foliage_set))
            ti += 1

    # --- event dressing -----------------------------------------------------
    for i in range(9):
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2, radius=rng.uniform(0.45, 0.7),
            location=(-9.0 + rng.uniform(-1.4, 1.4), -13.0 + rng.uniform(-1.0, 1.0),
                      0.6 + rng.uniform(0, 0.5)))
        o = bpy.context.object
        o.name = f"PLZ_flower_{i}"
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        o.data.materials.append(pink)

    for i, (x, y) in enumerate(((-4.2, -9.4), (-2.0, -9.9), (3.4, 8.6), (5.6, 9.2))):
        E.cyl(f"PLZ_cone_{i}", coll, 0.22, 0.62, (x, y, 0.31),
              material=cone, verts=10)

    # Parked cars and vans, both sides.
    for i, (x, y, mat) in enumerate(((-8.4, -9.0, darkmetal), (-12.6, -10.2, darkmetal),
                                     (10.2, 11.5, white), (14.6, 12.2, white),
                                     (-14.0, 9.5, white))):
        E.box(f"PLZ_car_{i}", coll, (1.9, 4.7, 1.05), (x, y, 0.55), material=mat)
        E.box(f"PLZ_carcab_{i}", coll, (1.65, 2.5, 0.62), (x, y - 0.3, 1.38), material=mat)

    for i, (x, y) in enumerate(((-16, -14), (-11, 13), (12, -15), (17, 14))):
        E.cyl(f"PLZ_pole_{i}", coll, 0.07, 9.0, (x, y, 4.5), material=white, verts=8)

    # Foreground columns. These are close to the lens and heavily defocused;
    # they are what wipes the left edge of S01 and travels across S05.
    E.box("PLZ_pillar_s01", coll, (0.20, 0.20, 6.4), (-0.32, 4.09, 3.2),
          material=concrete_dark)
    E.box("PLZ_pillar_a", coll, (0.30, 0.30, 6.0), (-1.62, -2.62, 3.0),
          material=concrete_dark)
    E.box("PLZ_pillar_b", coll, (0.46, 0.46, 6.0), (3.9, -3.1, 3.0), material=concrete)

    # --- mid-ground dressing ------------------------------------------------
    # Everything here sits between the crowd and the buildings. The first pass
    # left that band empty, so the defocused background was a flat grey field
    # with nothing to give it depth or colour. Under this much blur what reads
    # is value separation and a few saturated accents, not detail.
    blue = E._mat("PLZ_blue", (0.030, 0.075, 0.240), 0.62)
    orange = E._mat("PLZ_orange", (0.380, 0.140, 0.020), 0.64)
    signwhite = E._mat("PLZ_signwhite", (0.520, 0.520, 0.515), 0.58)
    darkgrey = E._mat("PLZ_darkgrey", (0.030, 0.030, 0.032), 0.60)
    lamp = E._mat("PLZ_lamp", None, 0, emit=(1.0, 0.94, 0.82), emit_str=6.0)
    glasslit = E._mat("PLZ_glasslit", None, 0, emit=(0.85, 0.88, 1.0), emit_str=1.5)

    rng2 = random.Random(91)

    # Crowd-barrier runs on both sides: a strong horizontal dark line that
    # separates the spectators from the road.
    for sgn in (1, -1):
        for i in range(11):
            x = -16.0 + i * 3.2
            E.box(f"PLZ_barrier_{sgn}_{i}", coll, (2.9, 0.06, 0.10),
                  (x, sgn * 7.9, 1.05), material=darkgrey)
            E.box(f"PLZ_barrier2_{sgn}_{i}", coll, (2.9, 0.06, 0.08),
                  (x, sgn * 7.9, 0.62), material=darkgrey)
            E.cyl(f"PLZ_barrierleg_{sgn}_{i}", coll, 0.035, 1.1,
                  (x - 1.45, sgn * 7.9, 0.55), material=darkgrey, verts=8)

    # Event signage: flat boards at varied heights, some lit. These are the
    # bright and coloured blobs the reference's bokeh is full of.
    signs = [(-14.5, -16.0, 2.6, signwhite), (-6.0, -17.5, 3.1, red),
             (7.5, -16.5, 2.4, blue), (15.0, -18.0, 2.9, signwhite),
             (-19.0, 12.5, 2.8, red), (-4.0, 14.0, 3.2, signwhite),
             (9.0, 13.0, 2.5, blue), (18.0, 15.0, 3.0, orange)]
    for i, (x, y, h, mat) in enumerate(signs):
        E.box(f"PLZ_sign_{i}", coll, (3.4, 0.12, 1.9), (x, y, h), material=mat)
        E.cyl(f"PLZ_signpost_a{i}", coll, 0.06, h, (x - 1.4, y, h / 2),
              material=darkgrey, verts=8)
        E.cyl(f"PLZ_signpost_b{i}", coll, 0.06, h, (x + 1.4, y, h / 2),
              material=darkgrey, verts=8)

    # Tall event flags: narrow verticals that break up the horizon.
    for i in range(10):
        x = -24.0 + i * 5.3 + rng2.uniform(-1.2, 1.2)
        y = (-19.0 if i % 2 else 16.0) + rng2.uniform(-1.5, 1.5)
        h = rng2.uniform(5.0, 7.0)
        mat = rng2.choice([red, blue, signwhite, orange])
        E.cyl(f"PLZ_flagpole_{i}", coll, 0.05, h, (x, y, h / 2),
              material=signwhite, verts=8)
        E.box(f"PLZ_flagcloth_{i}", coll, (0.75, 0.04, h * 0.55),
              (x + 0.4, y, h * 0.68), material=mat)

    # Street lighting: small hot points that bloom nicely out of focus.
    for i, (x, y) in enumerate(((-20, -12), (-9, -13), (4, -12.5), (16, -13),
                                (-18, 11), (-6, 12), (8, 11.5), (20, 12))):
        E.cyl(f"PLZ_lamppost_{i}", coll, 0.09, 8.0, (x, y, 4.0),
              material=darkgrey, verts=8)
        E.box(f"PLZ_lamphead_{i}", coll, (0.55, 0.28, 0.14), (x, y, 8.05),
              material=lamp)

    # Lit shopfront strips along the far buildings.
    for i in range(12):
        E.box(f"PLZ_litstrip_s{i}", coll, (4.2, 0.10, 0.9),
              (-30 + i * 5.6, -22.4, 2.4), material=glasslit)
    for i in range(10):
        E.box(f"PLZ_litstrip_n{i}", coll, (4.2, 0.10, 0.9),
              (-26 + i * 5.6, 22.4, 2.6), material=glasslit)

    # More parked metal at varied depths and values.
    carmats = [darkgrey, white, blue, red, E._mat("PLZ_silver", (0.18, 0.18, 0.19), 0.22,
                                                  metallic=0.75)]
    for i in range(14):
        x = -26.0 + i * 4.1 + rng2.uniform(-0.8, 0.8)
        y = (-15.5 if i % 2 else 15.5) + rng2.uniform(-1.4, 1.4)
        m = rng2.choice(carmats)
        E.box(f"PLZ_pcar_{i}", coll, (1.85, 4.5, 0.95), (x, y, 0.5), material=m)
        E.box(f"PLZ_pcabin_{i}", coll, (1.6, 2.3, 0.6), (x, y - 0.25, 1.28), material=m)

    # --- crowd --------------------------------------------------------------
    # Two arcs: a dense ring behind the car and a looser one to the sides.
    E.crowd_arc(coll, seed=11, count=34, radius_min=5.4, radius_max=9.8,
                angle_from=18, angle_to=162, jitter=1.3)
    E.crowd_arc(coll, seed=23, count=24, radius_min=5.2, radius_max=9.0,
                angle_from=188, angle_to=340, jitter=1.5)
    E.crowd_arc(coll, seed=37, count=16, radius_min=9.5, radius_max=12.5,
                angle_from=-25, angle_to=205)
    E.crowd_arc(coll, seed=53, count=12, radius_min=13.0, radius_max=16.5,
                angle_from=10, angle_to=180)
    return coll


def _wet_tarmac():
    """Wet asphalt: dark and rough over most of the surface, with broad
    low-roughness patches where standing water mirrors the sky. The sheen is
    what makes the ground read as wet rather than merely dark."""
    m = bpy.data.materials.get("PLZ_tarmac") or bpy.data.materials.new("PLZ_tarmac")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (300, 0)
    b.name = "Principled BSDF"
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])

    tc = nt.nodes.new("ShaderNodeNewGeometry"); tc.location = (-700, 0)
    wet = nt.nodes.new("ShaderNodeTexNoise"); wet.location = (-500, 100)
    wet.inputs["Scale"].default_value = 0.16
    wet.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Position"], wet.inputs["Vector"])
    wr = nt.nodes.new("ShaderNodeMapRange"); wr.location = (-300, 100)
    wr.clamp = True
    wr.inputs["From Min"].default_value = 0.38
    wr.inputs["From Max"].default_value = 0.62
    wr.inputs["To Min"].default_value = 0.155
    wr.inputs["To Max"].default_value = 0.56
    nt.links.new(wet.outputs["Fac"], wr.inputs["Value"])
    nt.links.new(wr.outputs["Result"], b.inputs["Roughness"])

    grain = nt.nodes.new("ShaderNodeTexNoise"); grain.location = (-500, -260)
    grain.inputs["Scale"].default_value = 26.0
    grain.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Position"], grain.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (-160, -260)
    bump.inputs["Strength"].default_value = 0.18
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])

    b.inputs["Base Color"].default_value = (0.0122, 0.0124, 0.0133, 1)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["IOR"].default_value = 1.46
    return m


def world():
    """Overcast dome. The reference sky measures sRGB (247,244,248) -- almost
    clipped -- while the car stays very dark, so the dome is bright and the
    ground bounce is deliberately weak."""
    w = bpy.data.worlds.get("WORLD_PLAZA") or bpy.data.worlds.new("WORLD_PLAZA")
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld"); out.location = (600, 0)
    bg = nt.nodes.new("ShaderNodeBackground"); bg.location = (380, 0)
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-500, 0)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-320, 0)
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange"); mr.location = (-140, 0)
    mr.clamp = True
    mr.inputs["From Min"].default_value = 0.02
    mr.inputs["From Max"].default_value = 0.34
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (60, 0)
    ramp.color_ramp.elements[0].color = (0.062, 0.064, 0.070, 1)   # ground haze
    ramp.color_ramp.elements[1].color = (0.980, 0.975, 1.000, 1)   # blown sky
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.70
    return w


def lights():
    """Reflection design for the overcast plaza.

    An overcast sky is one enormous source, so the body highlights in the
    reference are long soft horizontal smears with no hard specular. Three very
    large, very soft strips do that job: one overhead running the length of the
    car to draw the shoulder line, and two low side panels to keep the flanks
    from going black.
    """
    coll = K.new_collection("RIG_PLAZA")
    K.area_light("PLZ_KEY_SKY", coll, (-2.2, 1.6, 11.0),
                 (math.radians(14), 0, math.radians(-10)), 26, 9, 1450,
                 color=(1.0, 0.99, 1.0))
    K.area_light("PLZ_SIDE_L", coll, (-13.0, 1.0, 4.2),
                 (math.radians(74), 0, math.radians(-90)), 22, 7, 420)
    K.area_light("PLZ_SIDE_R", coll, (13.0, -1.0, 4.2),
                 (math.radians(74), 0, math.radians(90)), 22, 7, 420)
    K.area_light("PLZ_BACK", coll, (0.0, -14.0, 5.0),
                 (math.radians(70), 0, math.radians(180)), 20, 6, 380)
    # Wet-tarmac bounce, kept local to the car. A plaza-sized upward plane lit
    # the crowd and the buildings from underneath and flattened everything.
    K.area_light("PLZ_BOUNCE", coll, (0.0, 0.0, 0.18),
                 (math.radians(180), 0, 0), 6.5, 4.0, 70,
                 color=(0.97, 0.98, 1.0))
    K.area_light("PLZ_WHEEL_FILL", coll, (-3.4, 1.1, 0.42),
                 (math.radians(90), 0, math.radians(-90)), 3.0, 0.8, 95,
                 color=(0.98, 0.99, 1.0))
    K.area_light("PLZ_WHEEL_FILL_R", coll, (-3.4, -1.5, 0.42),
                 (math.radians(90), 0, math.radians(-90)), 3.0, 0.8, 75,
                 color=(0.98, 0.99, 1.0))
    return coll
