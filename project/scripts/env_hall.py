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


def _rough_surface(name, base, rough, scale, contrast, bump=0.35, metallic=0.0):
    """A surface with real tonal and roughness variation.

    Flat untextured concrete is the single loudest CG tell in the whole scene:
    it gives the car nothing interesting to reflect and reads as painted card.
    Everything large in this room gets broken up.
    """
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (620, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (320, 0)
    b.name = "Principled BSDF"
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])

    geo = nt.nodes.new("ShaderNodeNewGeometry"); geo.location = (-760, 0)
    n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.location = (-560, 140)
    n1.inputs["Scale"].default_value = scale
    n1.inputs["Detail"].default_value = 6.0
    n1.inputs["Roughness"].default_value = 0.62
    nt.links.new(geo.outputs["Position"], n1.inputs["Vector"])

    n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.location = (-560, -220)
    n2.inputs["Scale"].default_value = scale * 11.0
    n2.inputs["Detail"].default_value = 4.0
    nt.links.new(geo.outputs["Position"], n2.inputs["Vector"])

    cr = nt.nodes.new("ShaderNodeMapRange"); cr.location = (-320, 200)
    cr.clamp = True
    cr.inputs["From Min"].default_value = 0.5 - contrast
    cr.inputs["From Max"].default_value = 0.5 + contrast
    cr.inputs["To Min"].default_value = base * 0.62
    cr.inputs["To Max"].default_value = base * 1.45
    nt.links.new(n1.outputs["Fac"], cr.inputs["Value"])
    nt.links.new(cr.outputs["Result"], b.inputs["Base Color"])

    rr = nt.nodes.new("ShaderNodeMapRange"); rr.location = (-320, -20)
    rr.clamp = True
    rr.inputs["From Min"].default_value = 0.3
    rr.inputs["From Max"].default_value = 0.7
    rr.inputs["To Min"].default_value = max(0.02, rough - 0.14)
    rr.inputs["To Max"].default_value = min(1.0, rough + 0.14)
    nt.links.new(n2.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])

    bp = nt.nodes.new("ShaderNodeBump"); bp.location = (60, -300)
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.01
    nt.links.new(n2.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = metallic
    return m


def build():
    coll = K.new_collection(NAME)

    floor = _screed()
    conc = _rough_surface("HAL_concrete", 0.075, 0.68, 0.09, 0.18)
    conc_dark = _rough_surface("HAL_concrete_dark", 0.042, 0.72, 0.11, 0.20)
    conc_wall = _rough_surface("HAL_concrete_wall", 0.088, 0.66, 0.055, 0.22, bump=0.45)
    panel = E._mat("HAL_panel", (0.014, 0.014, 0.016), 0.42)
    panel_lit = E._mat("HAL_panel_logo", (0.62, 0.62, 0.63), 0.44)
    postm = E._mat("HAL_post", (0.020, 0.020, 0.022), 0.30, metallic=0.7)
    steel = _rough_surface("HAL_steel", 0.055, 0.36, 0.35, 0.22, metallic=0.85)
    darkcar = E._mat("HAL_darkcar", (0.035, 0.035, 0.038), 0.16, metallic=0.6, coat=0.7)
    palecar = E._mat("HAL_palecar", (0.320, 0.322, 0.330), 0.16, metallic=0.3, coat=0.7)
    flag = E._mat("HAL_flag", (0.016, 0.016, 0.018), 0.60)

    E.plane("HAL_floor", coll, HALL_W * 1.6, HALL_D * 1.6, (0, 0, 0), material=floor)
    E.plane("HAL_ceiling", coll, HALL_W * 1.6, HALL_D * 1.6, (0, 0, HALL_H),
            rotation=(math.pi, 0, 0), material=conc_dark)

    # --- enclose the room on all four sides ---------------------------------
    # Every hall camera in shots.py sits to the car's front-left and looks back
    # toward +X / -Y. The first version of this room only had walls at +Y and
    # -X, so all of its structure stood behind the lens and the car was filmed
    # against an empty grey void.
    E.box("HAL_wall_N", coll, (HALL_W, 0.5, HALL_H), (0, 16.5, HALL_H / 2),
          material=conc_wall)
    E.box("HAL_wall_S", coll, (HALL_W, 0.5, HALL_H), (0, -16.5, HALL_H / 2),
          material=conc_wall)
    E.box("HAL_wall_W", coll, (0.5, HALL_D, HALL_H), (-21.0, 0, HALL_H / 2),
          material=conc_wall)

    # --- window walls: the key light, and the brightest thing in frame ------
    win = E._mat("HAL_window", None, 0, emit=(1.0, 0.99, 0.99), emit_str=0.62)
    mull = E._mat("HAL_mullion", (0.020, 0.020, 0.022), 0.45, metallic=0.6)
    # East glazing (+X): directly behind the car in most framings.
    for i in range(7):
        y = -15.0 + i * 5.0
        E.box(f"HAL_winE_{i}", coll, (0.18, 4.4, 5.6), (20.6, y, 4.4), material=win)
        E.box(f"HAL_mullE_{i}", coll, (0.34, 0.34, 5.9), (20.5, y - 2.5, 4.4),
              material=mull)
    E.box("HAL_winE_head", coll, (0.6, HALL_D, 0.55), (20.5, 0, 7.4), material=mull)
    E.box("HAL_winE_sill", coll, (0.6, HALL_D, 1.5), (20.5, 0, 0.75), material=conc_wall)
    # South glazing (-Y): the other side most cameras look toward.
    for i in range(7):
        x = -15.0 + i * 5.2
        E.box(f"HAL_winS_{i}", coll, (4.6, 0.18, 5.2), (x, -16.2, 4.6), material=win)
        E.box(f"HAL_mullS_{i}", coll, (0.34, 0.34, 5.6), (x - 2.6, -16.3, 4.6),
              material=mull)
    E.box("HAL_winS_sill", coll, (HALL_W, 0.6, 1.8), (0, -16.3, 0.9),
          material=conc_wall)

    # --- roof structure -----------------------------------------------------
    for i in range(9):
        E.box(f"HAL_truss_{i}", coll, (HALL_W + 8, 0.26, 0.6),
              (0, -16 + i * 4.2, HALL_H - 0.45), material=steel)
    for i in range(6):
        E.cyl(f"HAL_duct_{i}", coll, 0.40, HALL_W + 6,
              (0, -13.0 + i * 5.4, HALL_H - 1.25),
              rotation=(0, math.radians(90), 0), material=steel, verts=14)

    # --- columns on a grid across the whole floor ---------------------------
    for i, x in enumerate((-15.5, -5.5, 4.5, 14.5)):
        for j, y in enumerate((-12.0, -2.0, 8.5)):
            if abs(x) < 6 and abs(y) < 6:
                continue                      # never inside the car's footprint
            E.box(f"HAL_col_{i}_{j}", coll, (1.15, 1.15, HALL_H),
                  (x, y, HALL_H / 2), material=conc)
            E.box(f"HAL_colcap_{i}_{j}", coll, (1.5, 1.5, 0.30),
                  (x, y, HALL_H - 0.32), material=conc_dark)

    # --- display dressing, spread around the car ---------------------------
    for i, (x, y, w, rot) in enumerate(((9.5, -9.0, 9.0, 0.0),
                                        (-11.0, -11.5, 7.0, 0.0),
                                        (15.5, 4.0, 8.0, math.pi / 2),
                                        (2.0, 10.5, 8.0, 0.0))):
        E.box(f"HAL_panel_{i}", coll, (w, 0.35, 1.15), (x, y, 0.575),
              rotation=(0, 0, rot), material=panel)
        E.box(f"HAL_panellogo_{i}", coll, (1.5, 0.06, 0.34),
              (x + math.cos(rot) * w * 0.3, y - math.sin(rot) * 0.21 - 0.21, 0.66),
              rotation=(0, 0, rot), material=panel_lit)

    litpanel = E._mat("HAL_litpanel", None, 0, emit=(0.92, 0.94, 1.0), emit_str=1.1)
    warmpanel = E._mat("HAL_warmpanel", None, 0, emit=(1.0, 0.86, 0.62), emit_str=1.4)
    accent = E._mat("HAL_accent", (0.300, 0.028, 0.030), 0.55)
    silver = E._mat("HAL_silver", (0.190, 0.190, 0.195), 0.24, metallic=0.8)
    carpet = E._mat("HAL_carpet", (0.022, 0.022, 0.026), 0.78)

    # Wall graphics on the two walls the cameras actually see.
    for i in range(7):
        E.box(f"HAL_wallpanelS_{i}", coll, (2.6, 0.06, 1.6),
              (-15.0 + i * 5.0, -16.15, 5.6), material=litpanel)
    for i in range(3):
        E.box(f"HAL_wallaccentS_{i}", coll, (0.5, 0.07, 2.4),
              (-10.0 + i * 10.0, -16.13, 5.6), material=accent)

    # Hanging banners, both sides.
    for i, (x, y) in enumerate(((-7.0, -15.6), (5.5, -15.6), (13.0, 12.0))):
        E.box(f"HAL_flag_{i}", coll, (1.6, 0.05, 3.4), (x, y, 5.8), material=flag)

    # Pendant fixtures: small warm points that read through the defocus.
    for i in range(7):
        for j in range(4):
            x, y = -14.0 + i * 4.8, -11.0 + j * 6.5
            E.box(f"HAL_pendant_{i}_{j}", coll, (1.6, 0.22, 0.10),
                  (x, y, HALL_H - 2.1), material=warmpanel)
            E.cyl(f"HAL_pendantrod_{i}_{j}", coll, 0.014, 1.95,
                  (x, y, HALL_H - 1.15), material=silver, verts=6)

    # Plinths and info boards, placed where the lens looks.
    for i, (x, y, w, h) in enumerate(((7.5, -6.5, 1.5, 1.05), (12.0, -3.0, 1.3, 0.95),
                                      (-8.0, -8.5, 1.4, 1.00), (14.0, 6.5, 1.6, 1.10))):
        E.box(f"HAL_plinth_{i}", coll, (w, w, h), (x, y, h / 2), material=panel)
        E.box(f"HAL_plinthtop_{i}", coll, (w * 1.08, w * 1.08, 0.05),
              (x, y, h + 0.02), material=silver)
    for i, (x, y, rot) in enumerate(((10.5, -11.0, 0.0), (-5.0, -12.5, 0.0),
                                     (16.5, -1.0, math.pi / 2), (-13.0, 6.0, 0.0))):
        E.box(f"HAL_board_{i}", coll, (2.1, 0.09, 1.35), (x, y, 1.55),
              rotation=(0, 0, rot), material=panel)
        E.box(f"HAL_boardlit_{i}", coll, (1.75, 0.03, 1.0),
              (x + math.sin(rot) * 0.06, y - math.cos(rot) * 0.06, 1.55),
              rotation=(0, 0, rot), material=litpanel)

    # Stanchions ringing the car, with rope between them.
    posts = [(-5.2, -5.6), (0.2, -6.2), (5.6, -6.0), (10.4, -4.6),
             (12.0, 0.8), (10.6, 6.0)]
    for i, (x, y) in enumerate(posts):
        E.cyl(f"HAL_post_{i}", coll, 0.035, 1.0, (x, y, 0.5), material=postm, verts=12)
        E.cyl(f"HAL_postbase_{i}", coll, 0.19, 0.035, (x, y, 0.018),
              material=postm, verts=18)
    for i in range(len(posts) - 1):
        (x0, y0), (x1, y1) = posts[i], posts[i + 1]
        E.box(f"HAL_rope_{i}", coll, (math.dist((x0, y0), (x1, y1)), 0.035, 0.035),
              ((x0 + x1) / 2, (y0 + y1) / 2, 0.90),
              rotation=(0, 0, math.atan2(y1 - y0, x1 - x0)), material=postm)

    E.plane("HAL_runner", coll, 8.0, 12.0, (0, 0, 0.004), material=carpet)

    # Other cars, on the sides the cameras look toward.
    for i, (x, y, val) in enumerate(((13.5, -11.0, 0.30), (17.5, -5.0, 0.045),
                                     (-13.0, -12.0, 0.17), (16.0, 9.0, 0.035),
                                     (-16.0, 4.0, 0.26))):
        m = E._mat(f"HAL_bgcar_{i}", (val, val, val * 1.04), 0.17,
                   metallic=0.55, coat=0.7)
        E.box(f"HAL_bgcar_{i}", coll, (1.9, 4.6, 0.80), (x, y, 0.43), material=m)
        E.box(f"HAL_bgcab_{i}", coll, (1.62, 2.4, 0.55), (x, y - 0.28, 1.05),
              material=m)

    # Staff and visitors, on the sides in shot.
    E.crowd_arc(coll, seed=71, count=14, radius_min=8.0, radius_max=15.0,
                angle_from=-95, angle_to=95, jitter=1.6)
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
    cr.inputs["To Min"].default_value = 0.130
    cr.inputs["To Max"].default_value = 0.235
    nt.links.new(n1.outputs["Fac"], cr.inputs["Value"])
    nt.links.new(cr.outputs["Result"], b.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange"); rr.location = (-300, 20)
    rr.clamp = True
    rr.inputs["From Min"].default_value = 0.35
    rr.inputs["From Max"].default_value = 0.68
    rr.inputs["To Min"].default_value = 0.09
    rr.inputs["To Max"].default_value = 0.26
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
    # Two window walls now, so two keys. The east glazing sits directly behind
    # the car in most framings and draws the long flank highlight; the south
    # glazing fills the side the wider shots look toward.
    K.area_light("HAL_KEY_WINDOW_E", coll, (17.8, 0.5, 4.3),
                 (math.radians(90), 0, math.radians(90)), 28, 6.0, 1500,
                 color=(1.0, 0.99, 0.98))
    K.area_light("HAL_KEY_WINDOW_S", coll, (0.0, -13.8, 4.4),
                 (math.radians(90), 0, math.radians(180)), 26, 5.6, 900,
                 color=(1.0, 0.99, 1.0))

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
