"""Location A: the outdoor plaza.

Built from what the reference reflections and defocused backgrounds actually
need, not from a plan of a real venue. The car is at the origin facing +Y.
"""
import bpy, math, random
import env_common as E
import lib_kseg as K
from env_hall import _rough_surface

NAME = "ENV_PLAZA"


def build():
    """The plaza ground.

    Everything that used to stand here -- buildings, trees, signage, the crowd --
    is now carried by the HDRI in env_world.py. Hand-built scenery was the thing
    keeping this from looking photographed: primitive figures stay primitive at
    any blur radius, and flat boxes give the paint nothing convincing to
    reflect. What an environment map cannot supply is the ground under the car,
    so that is all this builds.
    """
    coll = K.new_collection(NAME)
    tarmac = _wet_tarmac()

    # Large enough that its edge never reaches frame; the HDRI takes over at
    # the horizon.
    E.plane("PLZ_ground", coll, 400, 400, (0, 0, 0), material=tarmac)

    # Painted lines give the wet ground its only real texture in the rear
    # shots, and they anchor the car in frame.
    white = E._mat("PLZ_line", (0.230, 0.230, 0.226), 0.62)
    for x in (-6.4, 6.4):
        E.plane(f"PLZ_line_{x}", coll, 0.10, 30, (x, -4, 0.003), material=white)
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
    wr.inputs["To Min"].default_value = 0.055
    wr.inputs["To Max"].default_value = 0.34
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

    b.inputs["Base Color"].default_value = (0.0098, 0.0100, 0.0108, 1)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["IOR"].default_value = 1.46
    return m


def lights():
    """Reflection design for the overcast plaza.

    An overcast sky is one enormous source, so the body highlights in the
    reference are long soft horizontal smears with no hard specular. Three very
    large, very soft strips do that job: one overhead running the length of the
    car to draw the shoulder line, and two low side panels to keep the flanks
    from going black.
    """
    coll = K.new_collection("RIG_PLAZA")
    # With a photographic environment doing the lighting, these exist only to
    # draw specific highlights: one long overhead strip along the car to define
    # the shoulder line, and a low wrap so the sills and wheel arches are not
    # left black. Anything more competes with the HDRI and flattens it.
    K.area_light("PLZ_SHOULDER", coll, (-2.6, 0.6, 6.4),
                 (math.radians(12), 0, math.radians(-8)), 12, 2.2, 220,
                 color=(1.0, 0.99, 1.0))
    K.area_light("PLZ_WRAP_L", coll, (-5.2, 0.4, 1.1),
                 (math.radians(84), 0, math.radians(-90)), 8, 1.6, 60)
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
