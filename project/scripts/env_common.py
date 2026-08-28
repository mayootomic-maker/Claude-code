"""Environment pieces shared by both locations."""
import bpy, math, random
from mathutils import Vector


def _mat(name, base, rough, metallic=0.0, coat=0.0, emit=None, emit_str=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (400, 0)
    if emit is not None:
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = (*emit, 1)
        e.inputs["Strength"].default_value = emit_str
        nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
        return m
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (60, 0)
    b.name = "Principled BSDF"
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Coat Weight"].default_value = coat
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return m


def box(name, coll, size, location, rotation=(0, 0, 0), material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    o.rotation_euler = rotation
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    if material:
        o.data.materials.append(material)
    return o


def cyl(name, coll, radius, depth, location, rotation=(0, 0, 0), material=None, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth,
                                        location=location, vertices=verts)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = rotation
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    if material:
        o.data.materials.append(material)
    return o


def plane(name, coll, size_x, size_y, location, rotation=(0, 0, 0), material=None):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location)
    o = bpy.context.object
    o.name = name
    o.scale = (size_x, size_y, 1)
    o.rotation_euler = rotation
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    if material:
        o.data.materials.append(material)
    return o


# ------------------------------------------------------------------- crowd

CROWD_TOPS = [
    (0.020, 0.021, 0.024), (0.045, 0.048, 0.055), (0.012, 0.013, 0.016),
    (0.085, 0.030, 0.030), (0.030, 0.038, 0.060), (0.110, 0.105, 0.098),
    (0.055, 0.020, 0.022), (0.022, 0.030, 0.028), (0.140, 0.135, 0.125),
]
CROWD_LEGS = [
    (0.030, 0.038, 0.058), (0.018, 0.018, 0.020), (0.055, 0.055, 0.058),
    (0.012, 0.012, 0.014),
]
CROWD_SKIN = [(0.170, 0.108, 0.076), (0.115, 0.070, 0.048),
              (0.215, 0.145, 0.105), (0.075, 0.045, 0.030)]
CROWD_HAIR = [(0.014, 0.012, 0.011), (0.030, 0.022, 0.016),
              (0.055, 0.040, 0.024), (0.020, 0.018, 0.018)]


def _crowd_materials():
    mats = {"top": [], "leg": [], "skin": []}
    for i, c in enumerate(CROWD_TOPS):
        mats["top"].append(_mat(f"CROWD_top_{i}", c, 0.72))
    for i, c in enumerate(CROWD_LEGS):
        mats["leg"].append(_mat(f"CROWD_leg_{i}", c, 0.78))
    for i, c in enumerate(CROWD_SKIN):
        mats["skin"].append(_mat(f"CROWD_skin_{i}", c, 0.55))
    mats["hair"] = [_mat(f"CROWD_hair_{i}", c, 0.62)
                    for i, c in enumerate(CROWD_HAIR)]
    return mats


def make_person(name, coll, location, rot_z, rng, mats, scale=1.0):
    """A deliberately simple standing figure.

    Every spectator in the reference is either defocused or a silhouette, so
    detail here would be spent on pixels the depth of field destroys. What
    matters is correct height, stance spread and clothing value range, because
    that is all the blur leaves behind.
    """
    h = 1.58 + rng.random() * 0.26
    parts = []
    for side in (-1, 1):
        o = cyl(f"{name}_leg{side}", coll, 0.072, h * 0.47,
                (location[0] + side * 0.078, location[1], h * 0.235),
                material=rng.choice(mats["leg"]), verts=10)
        parts.append(o)
    # Torso as a rounded capsule. Boxes read as boxes even at f/2 -- their
    # straight silhouette edges survive the blur and the crowd looked like a
    # row of totems.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.20, segments=14, ring_count=9,
        location=(location[0], location[1], h * 0.47 + h * 0.18))
    t = bpy.context.object
    t.name = f"{name}_torso"
    t.scale = (0.88, 0.60, h * 0.36 / 0.40)
    for c in list(t.users_collection):
        c.objects.unlink(t)
    coll.objects.link(t)
    t.data.materials.append(rng.choice(mats["top"]))
    bpy.ops.object.shade_smooth()
    parts.append(t)
    arm_mat = rng.choice(mats["top"])
    for side in (-1, 1):
        o = cyl(f"{name}_arm{side}", coll, 0.048, h * 0.36,
                (location[0] + side * 0.192, location[1], h * 0.50 + h * 0.09),
                material=arm_mat, verts=8)
        parts.append(o)

    head_z = h * 0.47 + h * 0.36 + 0.095
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.086, segments=14, ring_count=10,
                                         location=(location[0], location[1], head_z))
    hd = bpy.context.object
    hd.name = f"{name}_head"
    hd.scale = (0.92, 1.0, 1.12)
    for c in list(hd.users_collection):
        c.objects.unlink(hd)
    coll.objects.link(hd)
    hd.data.materials.append(rng.choice(mats["skin"]))
    bpy.ops.object.shade_smooth()
    parts.append(hd)

    # A dark hair cap. Without it every head was a pale oval and the crowd
    # read as a row of skittles no matter how far out of focus it was.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.089, segments=14, ring_count=10,
                                         location=(location[0], location[1] + 0.008,
                                                   head_z + 0.020))
    hr = bpy.context.object
    hr.name = f"{name}_hair"
    hr.scale = (0.94, 1.0, 0.86)
    for c in list(hr.users_collection):
        c.objects.unlink(hr)
    coll.objects.link(hr)
    hr.data.materials.append(rng.choice(mats["hair"]))
    bpy.ops.object.shade_smooth()
    parts.append(hr)

    # Roughly half the reference crowd is holding a phone up at chest height.
    if rng.random() < 0.45:
        ph = box(f"{name}_phone", coll, (0.075, 0.012, 0.145),
                 (location[0] + rng.uniform(-0.08, 0.08), location[1] - 0.24,
                  h * 0.72),
                 material=mats["hair"][0])
        parts.append(ph)

    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    root.location = (0, 0, 0)
    for p in parts:
        p.parent = root
    root.location = (0, 0, 0)
    # rotate the whole figure about its own footprint
    for p in parts:
        p.location = (p.location.x - location[0], p.location.y - location[1], p.location.z)
    root.location = location
    root.rotation_euler = (0, 0, rot_z)
    root.scale = (scale, scale, scale)
    return root


def crowd_arc(coll, seed, count, radius_min, radius_max, angle_from, angle_to,
              jitter=0.9):
    """Scatter spectators around the car on an arc, facing inward."""
    rng = random.Random(seed)
    mats = _crowd_materials()
    people = []
    for i in range(count):
        a = math.radians(angle_from + (angle_to - angle_from) * (i / max(count - 1, 1)))
        a += rng.uniform(-0.06, 0.06)
        r = rng.uniform(radius_min, radius_max)
        x = math.cos(a) * r + rng.uniform(-jitter, jitter)
        y = math.sin(a) * r + rng.uniform(-jitter, jitter)
        facing = math.atan2(-y, -x) + math.pi / 2 + rng.uniform(-0.4, 0.4)
        people.append(make_person(f"PERSON_{seed}_{i:02d}", coll, (x, y, 0.0),
                                  facing, rng, mats,
                                  scale=rng.uniform(0.93, 1.06)))
    return people
