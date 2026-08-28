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
    """The hall floor.

    As with the plaza, the room itself is now the HDRI. Enclosing walls, glazing
    and structure built out of boxes read as boxes however they are lit, and the
    reflections they cast were the weakest part of every indoor shot.
    """
    coll = K.new_collection(NAME)
    floor = _screed()
    E.plane("HAL_floor", coll, 300, 300, (0, 0, 0), material=floor)
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
    cr.inputs["To Min"].default_value = 0.075
    cr.inputs["To Max"].default_value = 0.150
    nt.links.new(n1.outputs["Fac"], cr.inputs["Value"])
    nt.links.new(cr.outputs["Result"], b.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange"); rr.location = (-300, 20)
    rr.clamp = True
    rr.inputs["From Min"].default_value = 0.35
    rr.inputs["From Max"].default_value = 0.68
    rr.inputs["To Min"].default_value = 0.035
    rr.inputs["To Max"].default_value = 0.145
    nt.links.new(n1.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
    b.inputs["IOR"].default_value = 1.48
    return m


def lights():
    coll = K.new_collection("RIG_HALL")
    # The HDRI supplies the room and its light. These two shape the car:
    # a long soft strip drawing the flank highlight, and a small hard source
    # for the crisp round specular the reference's ceiling downlights make.
    K.area_light("HAL_FLANK", coll, (6.2, 0.4, 3.4),
                 (math.radians(66), 0, math.radians(90)), 11, 0.9, 620,
                 color=(1.0, 0.99, 0.98))
    K.area_light("HAL_SHOULDER", coll, (-1.6, -1.8, 4.4),
                 (math.radians(14), 0, math.radians(-6)), 11, 0.75, 380,
                 color=(1.0, 0.99, 0.99))
    K.area_light("HAL_WRAP_L", coll, (-4.6, 0.6, 1.0),
                 (math.radians(84), 0, math.radians(-90)), 7, 1.5, 70)
    K.area_light("HAL_REAR", coll, (-3.0, -4.0, 2.2),
                 (math.radians(68), 0, math.radians(-142)), 5.5, 1.6, 130,
                 color=(1.0, 0.99, 0.98))
    for i in range(3):
        d = bpy.data.lights.new(f"HAL_DL_{i}", type='POINT')
        d.energy = 90.0
        d.shadow_soft_size = 0.06
        d.color = (1.0, 0.96, 0.90)
        o = bpy.data.objects.new(f"HAL_DL_{i}", d)
        o.location = (-1.2 + i * 1.6, 2.2 - i * 1.4, 4.6)
        coll.objects.link(o)
    return coll
