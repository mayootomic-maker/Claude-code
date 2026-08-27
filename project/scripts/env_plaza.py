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
    foliage = E._mat("PLZ_foliage", (0.028, 0.052, 0.022), 0.80)
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
        n = 14 if along_x else 8
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
            for k in range(3):
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
                o.data.materials.append(foliage)
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
