"""Location B: the indoor exhibition hall.

The reference's indoor look needs two distinct systems, not one: a huge blown
window wall that draws the long clean highlight down the flank (S06, S18), and
small circular ceiling downlights that put crisp round specular dots on the
bonnet (S10, S17). A soft-only rig reproduces neither.
"""
import bpy, math, random
import env_common as E
import lib_kseg as K

NAME = "ENV_HALL"

HALL_W, HALL_D, HALL_H = 44.0, 34.0, 8.6


def build():
    coll = K.new_collection(NAME)

    floor = _screed()
    conc = E._mat("HAL_concrete", (0.082, 0.079, 0.074), 0.68)
    conc_dark = E._mat("HAL_concrete_dark", (0.072, 0.070, 0.066), 0.70)
    panel = E._mat("HAL_panel", (0.014, 0.014, 0.016), 0.42)
    panel_lit = E._mat("HAL_panel_logo", (0.62, 0.62, 0.63), 0.44)
    postm = E._mat("HAL_post", (0.020, 0.020, 0.022), 0.30, metallic=0.7)
    steel = E._mat("HAL_steel", (0.055, 0.055, 0.058), 0.34, metallic=0.85)
    darkcar = E._mat("HAL_darkcar", (0.035, 0.035, 0.038), 0.16, metallic=0.6, coat=0.7)
    palecar = E._mat("HAL_palecar", (0.320, 0.322, 0.330), 0.16, metallic=0.3, coat=0.7)
    flag = E._mat("HAL_flag", (0.016, 0.016, 0.018), 0.60)

    E.plane("HAL_floor", coll, HALL_W * 1.6, HALL_D * 1.6, (0, 0, 0), material=floor)
    E.plane("HAL_ceiling", coll, HALL_W * 1.6, HALL_D * 1.6, (0, 0, HALL_H),
            rotation=(math.pi, 0, 0), material=conc_dark)

    # Back wall behind the car (bare concrete in S17/S18/S20).
    E.box("HAL_wall_back", coll, (HALL_W, 0.5, HALL_H), (0, 15.5, HALL_H / 2),
          material=conc)
    E.box("HAL_wall_left", coll, (0.5, HALL_D, HALL_H), (-19.0, 0, HALL_H / 2),
          material=conc)

    # --- window wall: the dominant soft key ---------------------------------
    # Tall industrial glazing on the right, blown to white. Emissive rather
    # than transmissive so it lights the car directly and cheaply.
    win = E._mat("HAL_window", None, 0, emit=(1.0, 0.99, 0.99), emit_str=3.2)
    mull = E._mat("HAL_mullion", (0.020, 0.020, 0.022), 0.45, metallic=0.6)
    for i in range(6):
        y = -13.0 + i * 5.4
        E.box(f"HAL_win_{i}", coll, (0.18, 4.9, 5.6), (17.6, y, 4.4), material=win)
        E.box(f"HAL_mull_{i}", coll, (0.30, 0.34, 5.9), (17.5, y - 2.6, 4.4),
              material=mull)
    E.box("HAL_win_header", coll, (0.6, HALL_D, 0.5), (17.5, 0, 7.35), material=mull)
    E.box("HAL_win_sill", coll, (0.6, HALL_D, 1.6), (17.5, 0, 0.8), material=conc)

    # Roof trusses read as dark structure across the top of S18/S20.
    for i in range(7):
        E.box(f"HAL_truss_{i}", coll, (HALL_W, 0.22, 0.55),
              (0, -14 + i * 4.8, HALL_H - 0.5), material=steel)

    # --- columns ------------------------------------------------------------
    for i, x in enumerate((-11.5, -1.0, 9.5)):
        for j, y in enumerate((-6.0, 8.5)):
            E.box(f"HAL_col_{i}_{j}", coll, (1.15, 1.15, HALL_H),
                  (x, y, HALL_H / 2), material=conc)

    # --- display dressing ---------------------------------------------------
    # Black display panel with a logo strip, behind the car in S18/S20.
    E.box("HAL_panel_main", coll, (9.0, 0.35, 1.15), (5.0, 9.2, 0.575), material=panel)
    E.box("HAL_panel_logo", coll, (1.5, 0.06, 0.34), (8.1, 8.99, 0.66),
          material=panel_lit)
    E.box("HAL_panel_b", coll, (7.0, 0.35, 1.15), (-8.5, 9.2, 0.575), material=panel)

    # Wall strip with repeating marks (the printed banner in S17).
    E.box("HAL_wallstrip", coll, (26.0, 0.08, 0.42), (0, 15.2, 3.5), material=panel)
    for i in range(9):
        E.box(f"HAL_wallmark_{i}", coll, (0.85, 0.04, 0.20),
              (-11.0 + i * 2.8, 15.13, 3.5), material=panel_lit)

    # Hanging flag banners (the CARNA flags).
    for i, x in enumerate((-6.5, 6.0)):
        E.box(f"HAL_flag_{i}", coll, (1.5, 0.05, 3.2), (x, 14.6, 5.6), material=flag)

    # Rope stanchions: the strong foreground parallax element in S06 and S17.
    for i, (x, y) in enumerate(((-4.6, -5.4), (0.4, -5.9), (5.4, -6.2), (10.0, -5.6))):
        E.cyl(f"HAL_post_{i}", coll, 0.035, 1.0, (x, y, 0.5), material=postm, verts=12)
        E.cyl(f"HAL_postbase_{i}", coll, 0.19, 0.035, (x, y, 0.018),
              material=postm, verts=18)

    # Other cars parked behind, kept as simple masses: they only ever appear
    # as defocused blocks of value in the reference.
    for i, (x, y, mat) in enumerate(((-13.0, 11.5, palecar), (-6.5, 12.0, palecar),
                                     (13.5, 11.0, darkcar))):
        E.box(f"HAL_car_{i}", coll, (1.9, 4.5, 0.78), (x, y, 0.42), material=mat)
        E.box(f"HAL_carcab_{i}", coll, (1.65, 2.3, 0.52), (x, y - 0.25, 1.02),
              material=mat)

    # A handful of staff, never in focus.
    E.crowd_arc(coll, seed=71, count=5, radius_min=10.5, radius_max=13.5,
                angle_from=55, angle_to=125)
    return coll


def _screed():
    """Polished concrete screed: light, semi-reflective, with broad tonal
    variation. The floor bounce is what lifts the sills in every indoor shot."""
    m = bpy.data.materials.get("HAL_screed") or bpy.data.materials.new("HAL_screed")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (300, 0)
    b.name = "Principled BSDF"
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeNewGeometry"); tc.location = (-700, 0)
    n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.location = (-500, 120)
    n1.inputs["Scale"].default_value = 0.35
    n1.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Position"], n1.inputs["Vector"])
    cr = nt.nodes.new("ShaderNodeMapRange"); cr.location = (-300, 220)
    cr.clamp = True
    cr.inputs["From Min"].default_value = 0.35
    cr.inputs["From Max"].default_value = 0.68
    cr.inputs["To Min"].default_value = 0.155
    cr.inputs["To Max"].default_value = 0.245
    nt.links.new(n1.outputs["Fac"], cr.inputs["Value"])
    nt.links.new(cr.outputs["Result"], b.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange"); rr.location = (-300, 20)
    rr.clamp = True
    rr.inputs["From Min"].default_value = 0.35
    rr.inputs["From Max"].default_value = 0.68
    rr.inputs["To Min"].default_value = 0.22
    rr.inputs["To Max"].default_value = 0.40
    nt.links.new(n1.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
    b.inputs["IOR"].default_value = 1.48
    return m


def world():
    """The hall interior is not lit by sky; the world only stops the shadows
    from going absolutely black."""
    w = bpy.data.worlds.get("WORLD_HALL") or bpy.data.worlds.new("WORLD_HALL")
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.075, 0.078, 0.088, 1)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


def lights():
    coll = K.new_collection("RIG_HALL")

    # 1. The window wall as an actual light, camera-right. This is what draws
    #    the long unbroken highlight from nose to sill in S18.
    K.area_light("HAL_KEY_WINDOW", coll, (14.5, 0.5, 4.3),
                 (math.radians(90), 0, math.radians(90)), 26, 6.2, 3600,
                 color=(1.0, 0.99, 0.98))

    # 2. Circular ceiling downlights. Small and hard on purpose: these are the
    #    crisp round specular dots on the bonnet in S10 and S17, and a soft box
    #    cannot fake them.
    disc = E._mat("HAL_downlight", None, 0, emit=(1.0, 0.96, 0.90), emit_str=55.0)
    for i in range(5):
        for j in range(4):
            x = -9.0 + i * 4.6
            y = -7.5 + j * 5.2
            d = bpy.data.lights.new(f"HAL_DL_{i}_{j}", type='POINT')
            d.energy = 520.0
            d.shadow_soft_size = 0.10
            d.color = (1.0, 0.96, 0.90)
            o = bpy.data.objects.new(f"HAL_DL_{i}_{j}", d)
            o.location = (x, y, HALL_H - 0.35)
            coll.objects.link(o)
            # The visible fitting, so the dots also appear in reflections.
            E.cyl(f"HAL_DLdisc_{i}_{j}", coll, 0.16, 0.04,
                  (x, y, HALL_H - 0.30), material=disc, verts=16)

    # 3. Soft ceiling wash so the shadowed side is not dead.
    K.area_light("HAL_FILL_TOP", coll, (-4.0, 2.0, HALL_H - 0.8),
                 (0, 0, 0), 18, 14, 420, color=(0.96, 0.96, 1.0))

    # 4. Weak bounce from the bright screed into the sills.
    # The bright screed throws a lot of light back up. Without it the wheel
    # arches, sills and brake hardware read as solid black, which the
    # reference's indoor wheel shots plainly are not.
    K.area_light("HAL_BOUNCE", coll, (0, 0, 0.30),
                 (math.radians(180), 0, 0), 22, 18, 850,
                 color=(1.0, 0.97, 0.92))
    K.area_light("HAL_ARCH_FILL", coll, (7.5, 1.0, 0.55),
                 (math.radians(90), 0, math.radians(90)), 9, 1.4, 400,
                 color=(1.0, 0.98, 0.95))
    return coll
