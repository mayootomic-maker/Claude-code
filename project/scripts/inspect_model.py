"""Inspect the source Koenigsegg .blend and emit project/scene_inventory.json.

Read-only: opens the source file, walks the object hierarchy, and records
names, types, poly counts, world-space bounds and material assignments so
later scripts never have to guess object names.
"""
import bpy, json, sys, os
from mathutils import Vector

out_path = sys.argv[-1]

def world_bounds(objs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    found = False
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
            found = True
    return ([round(v, 4) for v in lo], [round(v, 4) for v in hi]) if found else (None, None)

objects = []
for o in bpy.data.objects:
    tris = 0
    if o.type == 'MESH' and o.data:
        tris = sum(max(len(p.vertices) - 2, 0) for p in o.data.polygons)
    lo, hi = world_bounds([o])
    objects.append({
        "name": o.name,
        "type": o.type,
        "parent": o.parent.name if o.parent else None,
        "collections": [c.name for c in o.users_collection],
        "tris": tris,
        "verts": len(o.data.vertices) if o.type == 'MESH' and o.data else 0,
        "materials": [m.name for m in o.material_slots.keys()] if False else [
            (s.material.name if s.material else None) for s in o.material_slots],
        "loc": [round(v, 4) for v in o.location],
        "dims": [round(v, 4) for v in o.dimensions] if o.type == 'MESH' else None,
        "bounds_min": lo, "bounds_max": hi,
        "hide_render": o.hide_render,
    })

materials = []
for m in bpy.data.materials:
    imgs = []
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                imgs.append(n.image.name)
    materials.append({
        "name": m.name,
        "users": m.users,
        "use_nodes": m.use_nodes,
        "images": sorted(set(imgs)),
    })

allmesh = [o for o in bpy.data.objects if o.type == 'MESH']
lo, hi = world_bounds(allmesh)

data = {
    "source_file": bpy.data.filepath,
    "blender_version_of_file": bpy.data.version[:],
    "counts": {
        "objects": len(bpy.data.objects),
        "meshes": len(allmesh),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "collections": len(bpy.data.collections),
        "total_tris": sum(o["tris"] for o in objects),
    },
    "scene_bounds_min": lo,
    "scene_bounds_max": hi,
    "scene_size": [round(hi[i] - lo[i], 4) for i in range(3)] if lo else None,
    "collections": [{"name": c.name, "objects": len(c.objects)} for c in bpy.data.collections],
    "objects": sorted(objects, key=lambda d: -d["tris"]),
    "materials": sorted(materials, key=lambda d: -d["users"]),
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w") as f:
    json.dump(data, f, indent=1)
print("INVENTORY_OK", data["counts"], "size", data["scene_size"])
