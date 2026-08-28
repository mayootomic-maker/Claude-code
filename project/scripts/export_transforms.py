"""Dump every object's evaluated world matrix from the source .blend.

The port places its wheels through a parent chain that ends in bone parenting.
Appending those objects and then re-parenting them crashes Blender's dependency
graph, so link_car() cuts the parents before anything enters the scene -- which
means the placement has to come from somewhere. It comes from here: the source
file is opened as the main file, where the depsgraph resolves normally, and
each object's world matrix is written out for link_car() to apply.

  blender -b -noaudio project/source/koenigsegg_source.blend \
      -P project/scripts/export_transforms.py
"""
import bpy, json, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, "source_transforms.json")

bpy.context.view_layer.update()
data = {}
for ob in bpy.data.objects:
    m = ob.matrix_world
    data[ob.name] = [[round(m[r][c], 6) for c in range(4)] for r in range(4)]

with open(out, "w") as f:
    json.dump(data, f, indent=0)
print(f"TRANSFORMS_EXPORTED {len(data)} objects -> {out}")
for n in ("_mesh", "_mesh.001", "_mesh.002", "_mesh.003"):
    if n in data:
        t = [data[n][r][3] for r in range(3)]
        print(f"  {n:10s} translation=({t[0]:7.3f},{t[1]:7.3f},{t[2]:7.3f})")
