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
    conc = E._mat("HAL_concrete", (0.052, 0.050, 0.047), 0.70)
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
    win = E._mat("HAL_window", None, 0, emit=(1.0, 0.99, 0.99), emit_str=1.35)
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

    # --- more hall structure ------------------------------------------------
    # The first pass left large empty stretches of floor and wall, so the
    # background behind the car was a featureless bright field. What the shots
    # need is depth: something at every distance between the car and the wall,
    # and a few lit surfaces to give the defocused areas shape.
    import random as _r
    rng = _r.Random(404)
    accent = E._mat("HAL_accent", (0.300, 0.028, 0.030), 0.55)
    litpanel = E._mat("HAL_litpanel", None, 0, emit=(0.92, 0.94, 1.0), emit_str=2.2)
    warmpanel = E._mat("HAL_warmpanel", None, 0, emit=(1.0, 0.86, 0.62), emit_str=2.6)
    silver = E._mat("HAL_silver", (0.190, 0.190, 0.195), 0.24, metallic=0.8)
    carpet = E._mat("HAL_carpet", (0.022, 0.022, 0.026), 0.78)

    # A second row of columns further back, and capitals on all of them.
    for i, x in enumerate((-16.0, -6.0, 4.5, 14.0)):
        E.box(f"HAL_col2_{i}", coll, (1.0, 1.0, HALL_H), (x, 13.0, HALL_H / 2),
              material=conc)
    for i, x in enumerate((-11.5, -1.0, 9.5)):
        for j, y in enumerate((-6.0, 8.5)):
            E.box(f"HAL_colcap_{i}_{j}", coll, (1.45, 1.45, 0.28),
                  (x, y, HALL_H - 0.30), material=conc_dark)

    # Ceiling services: ducting and hanging fixtures read as dark banding
    # across the top of the wide shots.
    for i in range(4):
        E.cyl(f"HAL_duct_{i}", coll, 0.38, HALL_W * 0.9,
              (0, -10.0 + i * 7.0, HALL_H - 1.15),
              rotation=(0, math.radians(90), 0), material=silver, verts=14)
    for i in range(6):
        for j in range(3):
            x, y = -12.0 + i * 5.0, -6.0 + j * 7.0
            E.box(f"HAL_pendant_{i}_{j}", coll, (1.6, 0.22, 0.10),
                  (x, y, HALL_H - 2.05), material=warmpanel)
            E.cyl(f"HAL_pendantrod_{i}_{j}", coll, 0.014, 1.9,
                  (x, y, HALL_H - 1.10), material=silver, verts=6)

    # Display plinths and info boards at mid distance.
    for i, (x, y, w, h) in enumerate(((-14.0, 4.0, 1.5, 1.05),
                                      (-9.5, 6.5, 1.2, 0.95),
                                      (12.5, 5.0, 1.6, 1.10),
                                      (15.5, -2.0, 1.3, 1.00))):
        E.box(f"HAL_plinth_{i}", coll, (w, w, h), (x, y, h / 2), material=panel)
        E.box(f"HAL_plinthtop_{i}", coll, (w * 1.08, w * 1.08, 0.05),
              (x, y, h + 0.02), material=silver)
    for i, (x, y) in enumerate(((-16.5, 7.5), (-2.5, 12.0), (11.0, 8.0), (16.0, 3.0))):
        E.box(f"HAL_board_{i}", coll, (2.1, 0.09, 1.35), (x, y, 1.55),
              material=panel)
        E.box(f"HAL_boardlit_{i}", coll, (1.75, 0.03, 1.0), (x, y - 0.06, 1.55),
              material=litpanel)
        E.cyl(f"HAL_boardleg_{i}", coll, 0.05, 0.9, (x, y, 0.45),
              material=silver, verts=8)

    # Wall graphics: lit panels break up the bare concrete behind the car.
    for i in range(6):
        E.box(f"HAL_wallpanel_{i}", coll, (2.6, 0.06, 1.6),
              (-13.0 + i * 5.2, 15.16, 4.6), material=litpanel)
    for i in range(3):
        E.box(f"HAL_wallaccent_{i}", coll, (0.5, 0.07, 2.4),
              (-9.0 + i * 9.0, 15.14, 4.6), material=accent)

    # Rope between the stanchions, and a carpet runner under the car.
    posts = ((-4.6, -5.4), (0.4, -5.9), (5.4, -6.2), (10.0, -5.6))
    for i in range(len(posts) - 1):
        (x0, y0), (x1, y1) = posts[i], posts[i + 1]
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        length = math.dist((x0, y0), (x1, y1))
        ang = math.atan2(y1 - y0, x1 - x0)
        E.box(f"HAL_rope_{i}", coll, (length, 0.035, 0.035), (mx, my, 0.90),
              rotation=(0, 0, ang), material=postm)
    E.plane("HAL_runner", coll, 7.5, 12.0, (0, 0, 0.004), material=carpet)

    # More parked metal behind, at varied values.
    for i, (x, y, val) in enumerate(((-17.0, 10.0, 0.28), (-2.0, 12.5, 0.045),
                                     (7.0, 12.0, 0.16), (17.5, 8.5, 0.035))):
        m = E._mat(f"HAL_bgcar_{i}", (val, val, val * 1.04), 0.17,
                   metallic=0.55, coat=0.7)
        E.box(f"HAL_bgcar_{i}", coll, (1.9, 4.6, 0.80), (x, y, 0.43), material=m)
        E.box(f"HAL_bgcab_{i}", coll, (1.62, 2.4, 0.55), (x, y - 0.28, 1.05),
              material=m)

    # A handful of staff, never in focus.
    E.crowd_arc(coll, seed=71, count=13, radius_min=8.5, radius_max=14.5,
                angle_from=35, angle_to=145, jitter=1.4)
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
    cr.inputs["To Min"].default_value = 0.095
    cr.inputs["To Max"].default_value = 0.160
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
    bg.inputs["Color"].default_value = (0.030, 0.031, 0.036, 1)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return w


def lights():
    coll = K.new_collection("RIG_HALL")

    # 1. The window wall as an actual light, camera-right. This is what draws
    #    the long unbroken highlight from nose to sill in S18.
    K.area_light("HAL_KEY_WINDOW", coll, (14.5, 0.5, 4.3),
                 (math.radians(90), 0, math.radians(90)), 26, 6.2, 1050,
                 color=(1.0, 0.99, 0.98))

    # 2. Circular ceiling downlights. Small and hard on purpose: these are the
    #    crisp round specular dots on the bonnet in S10 and S17, and a soft box
    #    cannot fake them.
    disc = E._mat("HAL_downlight", None, 0, emit=(1.0, 0.96, 0.90), emit_str=22.0)
    for i in range(5):
        for j in range(4):
            x = -9.0 + i * 4.6
            y = -7.5 + j * 5.2
            d = bpy.data.lights.new(f"HAL_DL_{i}_{j}", type='POINT')
            d.energy = 185.0
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
                 (0, 0, 0), 18, 14, 105, color=(0.96, 0.96, 1.0))

    # 4. Weak bounce from the bright screed into the sills.
    # Floor bounce, kept local. A room-sized upward plane lit every wall and
    # every spectator from below and turned the hall into a white void; what
    # the shots actually need is light under the car itself.
    K.area_light("HAL_BOUNCE", coll, (0, 0, 0.18),
                 (math.radians(180), 0, 0), 6.5, 4.0, 55,
                 color=(1.0, 0.97, 0.92))
    # Low raking fill on the camera side, at wheel-centre height: this is what
    # puts the carbon spokes, disc and caliper back into the arch.
    K.area_light("HAL_WHEEL_FILL", coll, (-4.2, 1.0, 0.42),
                 (math.radians(90), 0, math.radians(-90)), 3.0, 0.8, 75,
                 color=(1.0, 0.98, 0.95))
    K.area_light("HAL_WHEEL_FILL_R", coll, (-4.2, -1.3, 0.42),
                 (math.radians(90), 0, math.radians(-90)), 3.0, 0.8, 55,
                 color=(1.0, 0.98, 0.95))
    return coll
