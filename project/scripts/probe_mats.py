"""Report which materials actually cover polygons, so the material rebuild
targets real surfaces instead of unused GTA slots."""
import bpy, sys, os
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K

K.purge_scene()
K.link_car()
use = defaultdict(lambda: {"tris": 0, "objs": set()})
for o in K.car_objects():
    slots = [s.material.name if s.material else None for s in o.material_slots]
    for p in o.data.polygons:
        if p.material_index < len(slots):
            n = slots[p.material_index]
            if n:
                use[n]["tris"] += max(len(p.vertices) - 2, 0)
                use[n]["objs"].add(o.name)
rows = []
for n, d in use.items():
    m = bpy.data.materials.get(n)
    imgs = []
    if m and m.use_nodes:
        imgs = sorted({nd.image.name for nd in m.node_tree.nodes
                       if nd.type == 'TEX_IMAGE' and nd.image})
    rows.append((d["tris"], n, sorted(d["objs"])[:4], imgs[:4]))
rows.sort(reverse=True)
print("=== MATERIALS COVERING POLYGONS ===")
for t, n, objs, imgs in rows:
    print(f"{t:>7d}  {n:32s} objs={objs} imgs={imgs}")
print("TOTAL_USED_MATERIALS", len(rows))
