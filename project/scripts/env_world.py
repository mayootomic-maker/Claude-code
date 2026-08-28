"""One world datablock holding both locations' HDRIs.

A scene has a single world, and a world datablock cannot be swapped on a
keyframe -- but a node socket can. Both environments live in one node tree and
are cross-faded by a factor keyed per shot with constant interpolation, with a
third state that takes the world to black for the outro.

Photographic environments replace what used to be hand-built scenery. Boxes and
primitive figures have a hard ceiling: they give the paint nothing convincing to
reflect, and reflections are most of what sells a car render. An HDRI gives real
light direction, real colour and a real background in one step.
"""
import bpy, os, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HDRI_DIR = os.path.join(ROOT, "assets", "hdri")

# Poly Haven, CC0.
PLAZA_HDRI = "potsdamer_platz_4k.hdr"        # overcast urban plaza, glass buildings
HALL_HDRI = "aircraft_workshop_01_4k.hdr"    # large industrial interior, tall windows

# Rotation puts each environment's most useful structure behind the car, since
# every camera in shots.py looks from the car's front-left back toward +X/-Y.
PLAZA_ROTATION = math.radians(118.0)
HALL_ROTATION = math.radians(-52.0)
PLAZA_STRENGTH = 1.0
HALL_STRENGTH = 1.15

NAME = "WORLD_MASTER"


def _hdri_path(filename):
    p = os.path.join(HDRI_DIR, filename)
    if not os.path.exists(p):
        raise RuntimeError(
            f"{p} is missing. Fetch the HDRIs with project/scripts/bootstrap.sh")
    return p


def _branch(nt, tex_coord, filename, rotation, strength, y):
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.location = (-700, y)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, rotation)
    nt.links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])

    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.location = (-480, y)
    env.image = bpy.data.images.load(_hdri_path(filename), check_existing=True)
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])

    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (-200, y)
    bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    return bg


def build():
    """Returns (world, location_mix_node, black_mix_node)."""
    w = bpy.data.worlds.get(NAME) or bpy.data.worlds.new(NAME)
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    out = nt.nodes.new("ShaderNodeOutputWorld"); out.location = (520, 0)
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-920, 0)

    plaza = _branch(nt, tc, PLAZA_HDRI, PLAZA_ROTATION, PLAZA_STRENGTH, 180)
    hall = _branch(nt, tc, HALL_HDRI, HALL_ROTATION, HALL_STRENGTH, -180)

    loc_mix = nt.nodes.new("ShaderNodeMixShader")
    loc_mix.location = (60, 0)
    loc_mix.name = "LOCATION_MIX"
    loc_mix.inputs["Fac"].default_value = 0.0        # 0 = plaza, 1 = hall
    nt.links.new(plaza.outputs["Background"], loc_mix.inputs[1])
    nt.links.new(hall.outputs["Background"], loc_mix.inputs[2])

    black = nt.nodes.new("ShaderNodeBackground")
    black.location = (60, -320)
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    black.inputs["Strength"].default_value = 0.0

    black_mix = nt.nodes.new("ShaderNodeMixShader")
    black_mix.location = (300, 0)
    black_mix.name = "BLACK_MIX"
    black_mix.inputs["Fac"].default_value = 0.0      # 1 = world off, for the outro
    nt.links.new(loc_mix.outputs["Shader"], black_mix.inputs[1])
    nt.links.new(black.outputs["Background"], black_mix.inputs[2])
    nt.links.new(black_mix.outputs["Shader"], out.inputs["Surface"])
    return w, loc_mix, black_mix
