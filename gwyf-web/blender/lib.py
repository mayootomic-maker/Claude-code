"""Shared Blender scaffolding for the Gamble With Your Friends asset renders.

Everything here is procedural. There are no .blend files and no downloaded
textures, so a checkout can reproduce every pixel in the game with one command
and no binary assets in git history that nobody can regenerate.
"""

import math
import os

import bpy  # must precede bmesh: the pip build registers the submodules on import
import bmesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

TAU = math.pi * 2


# --- scene ------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.02, 0.017, 0.016, 1.0)
    bg.inputs[1].default_value = 1.0


def render_config(w, h, samples=96, transparent=True):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    # Caustics off: the gold and chrome here throw fireflies that denoising then
    # smears into grey blotches, which is worse than the caustic being missing.
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.render.resolution_x = w
    s.render.resolution_y = h
    s.render.resolution_percentage = 100
    s.render.film_transparent = transparent
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.render.image_settings.compression = 90
    s.view_settings.view_transform = "Filmic"
    s.view_settings.look = "Medium High Contrast"


def camera(location, rotation, ortho=None, lens=50):
    bpy.ops.object.camera_add(location=location, rotation=rotation)
    cam = bpy.context.object
    if ortho is not None:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    bpy.context.scene.camera = cam
    return cam


def area(location, energy, size=6, color=(1, 1, 1), track=None):
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.data.energy = energy
    light.data.size = size
    light.data.color = color
    if track is not None:
        con = light.constraints.new("TRACK_TO")
        con.target = track
    return light


def three_point(target, key=900, fill=200, rim=600, spread=5.0):
    """Key from upper left, soft fill from the right, rim from behind.

    `spread` scales the whole rig with the subject so the same call lights a
    coin and a tower without the lights ending up inside the geometry.
    """
    d = spread
    area((-d, -d, d * 1.1), key, size=d * 1.4, color=(1.0, 0.96, 0.9), track=target)
    area((d * 1.2, -d * 0.6, d * 0.3), fill, size=d * 2.0, color=(0.85, 0.9, 1.0), track=target)
    area((0.4 * d, d * 1.2, d * 0.9), rim, size=d * 0.8, color=(1.0, 0.82, 0.55), track=target)


def empty(location=(0, 0, 0)):
    bpy.ops.object.empty_add(location=location)
    return bpy.context.object


def save(name):
    path = os.path.join(ASSETS, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


# --- materials --------------------------------------------------------------

def _set(bsdf, names, value):
    """Set the first input that exists under any of `names`.

    Principled BSDF socket names moved in 4.0 (Emission -> Emission Color,
    Specular -> Specular IOR Level). Naming several candidates keeps this script
    working across the versions rather than pinning one.
    """
    for n in names:
        if n in bsdf.inputs:
            bsdf.inputs[n].default_value = value
            return True
    return False


def mat(name, color, metallic=0.0, roughness=0.4, emission=None,
        emission_strength=0.0, ior=1.45, transmission=0.0, clearcoat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    _set(b, ["Base Color"], (*color, 1.0))
    _set(b, ["Metallic"], metallic)
    _set(b, ["Roughness"], roughness)
    _set(b, ["IOR"], ior)
    _set(b, ["Transmission Weight", "Transmission"], transmission)
    _set(b, ["Coat Weight", "Clearcoat"], clearcoat)
    if emission is not None:
        _set(b, ["Emission Color", "Emission"], (*emission, 1.0))
        _set(b, ["Emission Strength"], emission_strength)
    return m


GOLD = lambda: mat("gold", (0.78, 0.56, 0.20), metallic=1.0, roughness=0.22)
BRASS = lambda: mat("brass", (0.62, 0.45, 0.19), metallic=1.0, roughness=0.32)
CHROME = lambda: mat("chrome", (0.86, 0.87, 0.90), metallic=1.0, roughness=0.08)
IVORY = lambda: mat("ivory", (0.93, 0.90, 0.84), roughness=0.28, clearcoat=0.6)
JET = lambda: mat("jet", (0.022, 0.020, 0.021), roughness=0.30, clearcoat=0.4)
FELT = lambda: mat("felt", (0.05, 0.16, 0.09), roughness=0.95)
CRIMSON = lambda: mat("crimson", (0.42, 0.035, 0.055), roughness=0.32, clearcoat=0.5)


def apply(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


# --- mesh helpers -----------------------------------------------------------

def smooth(obj, angle=math.radians(40)):
    """Shade smooth but keep hard edges past `angle`.

    Blender 4.1 removed mesh.use_auto_smooth in favour of an operator that adds
    a modifier, and 5.0 removed the attribute entirely, so this asks for the
    operator and falls back to plain smooth shading rather than pinning a version.
    """
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.shade_auto_smooth(angle=angle)
    except (AttributeError, RuntimeError, TypeError):
        bpy.ops.object.shade_smooth()
    return obj


def bevel(obj, width=0.02, segments=4, clamp=True):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(30)
    m.use_clamp_overlap = clamp
    return obj


def cylinder(radius, depth, verts=96, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=verts, location=location, rotation=rotation)
    return bpy.context.object


def cube(size=1, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cube_add(size=size, location=location, rotation=rotation)
    o = bpy.context.object
    o.scale = scale
    return o


def sphere(radius=1, location=(0, 0, 0), segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, location=location, segments=segments, ring_count=rings)
    o = bpy.context.object
    smooth(o)
    return o


def text(body, size=1.0, extrude=0.04, location=(0, 0, 0), rotation=(0, 0, 0), bold_scale=1.0):
    bpy.ops.object.text_add(location=location, rotation=rotation)
    o = bpy.context.object
    o.data.body = body
    o.data.size = size
    o.data.extrude = extrude
    o.data.align_x = "CENTER"
    o.data.align_y = "CENTER"
    o.data.offset = 0.006 * bold_scale
    o.data.bevel_depth = 0.004 * bold_scale
    o.data.resolution_u = 4
    return o


def star(points=5, outer=1.0, inner=0.42, depth=0.1, location=(0, 0, 0), rotation=(0, 0, 0)):
    """A star as real geometry rather than a glyph, so it bevels and catches
    light like the rest of the coin instead of reading as a decal."""
    me = bpy.data.meshes.new("star")
    obj = bpy.data.objects.new("star", me)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    verts = []
    for i in range(points * 2):
        r = outer if i % 2 == 0 else inner
        a = TAU * i / (points * 2) + math.pi / 2
        verts.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0)))
    bm.faces.new(verts)
    # Thickness comes from the solidify modifier below. Extruding here as well
    # leaves a second face coplanar with the first, which renders black when the
    # camera is square to it -- visible on exactly one frame of a flip.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    obj.location = location
    obj.rotation_euler = rotation
    m = obj.modifiers.new("solidify", "SOLIDIFY")
    m.thickness = depth
    m.offset = 0
    return obj


def join(objects, active=None):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    active = active or objects[0]
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.join()
    return bpy.context.object


def parent_to(objects, parent):
    """Parent without moving anything, so a rig can be spun about the world
    origin. Joining instead would move the group's origin onto whichever object
    happened to be active, which silently throws the rest of the rig off-axis."""
    for o in objects:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return parent


def lathe(profile, segments=64, name="lathe", cap=False):
    """Spin a 2D profile (list of (radius, z)) about Z.

    Bells, turrets and cups are all one profile and a spin; modelling them from
    primitives means unions that leave visible seams under a specular highlight.
    """
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    ring = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((ring[i], ring[i + 1])) for i in range(len(ring) - 1)]
    bmesh.ops.spin(bm, geom=ring + edges, axis=(0, 0, 1), cent=(0, 0, 0),
                   dvec=(0, 0, 0), angle=TAU, steps=segments, use_merge=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if cap:
        bmesh.ops.holes_fill(bm, edges=bm.edges[:])
    bm.to_mesh(me)
    bm.free()
    smooth(obj)
    return obj


def annular_sector(r_in, r_out, a0, a1, z0, z1, steps=8, name="sector"):
    """A solid slice of a ring -- one pocket of a roulette rotor."""
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    lower, upper = [], []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        c, s = math.cos(a), math.sin(a)
        lower.append((r_in * c, r_in * s))
        upper.append((r_out * c, r_out * s))
    outline = lower + list(reversed(upper))
    verts = [bm.verts.new((x, y, z0)) for x, y in outline]
    face = bm.faces.new(verts)
    r = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, 0, z1 - z0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    return obj


def torus(major, minor, location=(0, 0, 0), rotation=(0, 0, 0), major_seg=64, minor_seg=16):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=location, rotation=rotation,
        major_segments=major_seg, minor_segments=minor_seg)
    o = bpy.context.object
    smooth(o)
    return o


def cone(r1, r2, depth, location=(0, 0, 0), rotation=(0, 0, 0), verts=64):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth,
                                    location=location, rotation=rotation, vertices=verts)
    o = bpy.context.object
    smooth(o)
    return o


def plane(size, location=(0, 0, 0), rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=location, rotation=rotation)
    return bpy.context.object


def decimate(obj, ratio):
    """Collapse an object's triangle count.

    These models are shown at a couple of hundred pixels on a reel or a wheel,
    where the difference between five thousand triangles and fifteen hundred is
    invisible -- and the difference on a phone's GPU is not.
    """
    m = obj.modifiers.new("decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    m.use_collapse_triangulate = True
    return obj
