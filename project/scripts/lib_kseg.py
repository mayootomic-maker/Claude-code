"""Shared helpers for the Koenigsegg reference-match project.

Everything here is deterministic and idempotent so the master scene can be
rebuilt from the untouched source .blend at any time.
"""
import bpy, os, math, json
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_BLEND = os.path.join(ROOT, "source", "koenigsegg_source.blend")
TRANSFORMS_JSON = os.path.join(ROOT, "source_transforms.json")

# The car runs along Y with the nose at +Y. The ground lift is measured from
# the geometry at import time rather than hard-coded, because the hard-coded
# value was read off a wheel that turned out to be mispositioned.
# Objects in the source that are scene dressing from the original author,
# not part of the car.
SOURCE_JUNK = {"Plane", "Text", "Camera", "Spot", "Spot.001"}

FPS = 60


def purge_scene():
    """Empty the current file completely, leaving one clean scene."""
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras,
                  bpy.data.armatures, bpy.data.curves):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def link_car(target_collection_name="KOENIGSEGG"):
    """Append every car object from the untouched source into a named collection.

    The source is a GTA V port whose meshes hang off empties that are in turn
    bone-parented to an armature. Appending those objects and then re-parenting
    them makes Blender's dependency graph fall over, so every parent is cut
    before anything is linked into the scene.

    Cutting the parents also throws away the placement they carried -- and for
    the four wheels that placement is the only thing putting them in the arches.
    An earlier version assumed all the parents were identity transforms; they
    are not, and the result was three wheels scattered outside the bodywork and
    one sitting inside the cabin. The real world matrices are read back from
    project/source_transforms.json, exported by export_transforms.py with the
    source opened as the main file, where the depsgraph resolves normally.

    The car is then lifted so its lowest vertex rests on Z=0, which every
    camera, light and environment in this project assumes.

    Returns (collection, root_empty).
    """
    transforms = _load_source_transforms()

    with bpy.data.libraries.load(SOURCE_BLEND, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n not in SOURCE_JUNK]

    coll = bpy.data.collections.new(target_collection_name)
    bpy.context.scene.collection.children.link(coll)

    loaded = [o for o in dst.objects if o is not None]
    for ob in loaded:
        ob.parent = None
        ob.parent_type = 'OBJECT'
        ob.parent_bone = ""

    for ob in loaded:
        coll.objects.link(ob)

    missing = []
    for ob in loaded:
        m = transforms.get(ob.name)
        if m is None:
            missing.append(ob.name)
            continue
        ob.matrix_world = Matrix(m)
    if missing:
        raise RuntimeError(
            "no exported transform for: %s -- rerun export_transforms.py" % missing)
    bpy.context.view_layer.update()

    # The armature and the port's rig empties have no further purpose.
    for ob in list(loaded):
        if ob.type in {'ARMATURE', 'EMPTY'}:
            bpy.data.objects.remove(ob, do_unlink=True)
            loaded.remove(ob)

    lift = -_lowest_vertex_z(loaded)

    root = bpy.data.objects.new("KSEG_ROOT", None)
    root.empty_display_type = 'PLAIN_AXES'
    root.empty_display_size = 1.5
    coll.objects.link(root)

    # An identity parent inverse is deliberate. Setting it to the inverse of the
    # root's matrix -- the usual "keep transform" idiom -- cancels the root's
    # own transform, which is why the ground lift silently did nothing and the
    # whole car rendered sunk into the tarmac.
    for ob in loaded:
        ob.parent = root
        ob.matrix_parent_inverse = Matrix.Identity(4)
    root.location = (0.0, 0.0, lift)
    bpy.context.view_layer.update()
    return coll, root


def _load_source_transforms():
    if not os.path.exists(TRANSFORMS_JSON):
        raise RuntimeError(
            "%s is missing. Generate it with:\n"
            "  blender -b -noaudio %s -P %s/export_transforms.py"
            % (TRANSFORMS_JSON, SOURCE_BLEND, os.path.join(ROOT, "scripts")))
    with open(TRANSFORMS_JSON) as f:
        return json.load(f)


def _lowest_vertex_z(objects):
    """True lowest point, from vertices rather than bounding boxes."""
    lo = 1e9
    for ob in objects:
        if ob.type != 'MESH':
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            z = (mw @ v.co).z
            if z < lo:
                lo = z
    return lo


def car_objects():
    """Every mesh object belonging to the car."""
    coll = bpy.data.collections.get("KOENIGSEGG")
    return [o for o in coll.objects if o.type == 'MESH'] if coll else []


def new_collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def area_light(name, coll, location, rotation, size, size_y, energy,
               color=(1, 1, 1), spread=math.radians(120)):
    """A rectangular strip light. Automotive lighting is reflection design:
    these exist to draw a specific highlight shape on the body, not to
    illuminate the scene evenly."""
    d = bpy.data.lights.new(name, type='AREA')
    d.shape = 'RECTANGLE'
    d.size, d.size_y = size, size_y
    d.energy = energy
    d.color = color
    d.spread = spread
    ob = bpy.data.objects.new(name, d)
    ob.location = location
    ob.rotation_euler = rotation
    coll.objects.link(ob)
    return ob


def look_at(obj, target, roll=0.0):
    """Aim -Z at a point with +Y up, the way a camera constraint would."""
    d = (Vector(target) - obj.location)
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if roll:
        obj.rotation_euler.rotate_axis('Z', roll)


def make_camera(name, coll, lens, sensor=36.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = sensor
    cd.clip_start = 0.01
    cd.clip_end = 500.0
    ob = bpy.data.objects.new(name, cd)
    coll.objects.link(ob)
    return ob


def principled(mat):
    return mat.node_tree.nodes.get("Principled BSDF")


def new_material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.name = "Principled BSDF"
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    out.location = (400, 0)
    return m, nt, bsdf


def set_cycles(scene, samples, res_x=1920, res_y=1080, pct=100, denoise=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.use_denoising = denoise
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.max_bounces = 12
    scene.cycles.glossy_bounces = 8
    scene.cycles.transmission_bounces = 12
    scene.cycles.transparent_max_bounces = 12
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.resolution_percentage = pct
    scene.render.film_transparent = False
    scene.render.fps = FPS
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
