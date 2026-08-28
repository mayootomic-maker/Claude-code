"""Audit the car's geometry: anything below the ground plane, anything far
outside the body envelope, and clean orthographic views to look at."""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
from mathutils import Vector

K.purge_scene()
S = bpy.context.scene
coll, root = K.link_car()
bpy.context.view_layer.update()

print("=== PER-OBJECT WORLD BOUNDS (after the ground-lift) ===")
below, wide = [], []
for o in sorted(K.car_objects(), key=lambda x: x.name):
    lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
    flag = ""
    if lo.z < -0.002:
        below.append((o.name, round(lo.z, 4))); flag += " BELOW_GROUND"
    if abs(lo.x) > 1.25 or abs(hi.x) > 1.25 or hi.y > 2.45 or lo.y < -2.45 or hi.z > 1.45:
        wide.append((o.name, [round(v,3) for v in lo], [round(v,3) for v in hi])); flag += " OUTSIDE_ENVELOPE"
    print(f"{o.name:18s} min=({lo.x:6.3f},{lo.y:6.3f},{lo.z:6.3f}) "
          f"max=({hi.x:6.3f},{hi.y:6.3f},{hi.z:6.3f}) tris={len(o.data.polygons)}{flag}")

print("\n=== BELOW GROUND ===", below if below else "none")
print("=== OUTSIDE ENVELOPE ===")
for w in wide:
    print("  ", w)

# True lowest vertex, not just bounding boxes.
lowest = (1e9, None)
for o in K.car_objects():
    for v in o.data.vertices:
        z = (o.matrix_world @ v.co).z
        if z < lowest[0]:
            lowest = (z, o.name)
print(f"\nLOWEST_VERTEX z={lowest[0]:.4f} on {lowest[1]}  (should be ~0.000)")

# ---- clean orthographic views -----------------------------------------
w = bpy.data.worlds.new("w"); S.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.35, 0.36, 0.40, 1); bg.inputs[1].default_value = 1.0
L = K.new_collection("L")
K.area_light("k1", L, (-6, 4, 6), (math.radians(48), 0, math.radians(-38)), 10, 4, 2600)
K.area_light("k2", L, (6, -3, 5), (math.radians(52), 0, math.radians(148)), 9, 3, 1400)

# A checkerboard floor makes it obvious if anything sinks into it.
bpy.ops.mesh.primitive_plane_add(size=40)
g = bpy.context.object
gm, nt, b = K.new_material("audit_floor")
chk = nt.nodes.new("ShaderNodeTexChecker")
chk.inputs["Scale"].default_value = 40.0
chk.inputs["Color1"].default_value = (0.30, 0.30, 0.32, 1)
chk.inputs["Color2"].default_value = (0.14, 0.14, 0.16, 1)
nt.links.new(chk.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.6
g.data.materials.append(gm)

cams = K.new_collection("C")
views = [("side",  (12, 0, 0.62), (0, 0, 0.62), 3.2),
         ("front", (0, 12, 0.62), (0, 0, 0.62), 2.6),
         ("rear",  (0, -12, 0.62), (0, 0, 0.62), 2.6),
         ("top",   (0, 0, 12), (0, 0, 0), 5.4),
         ("low34", (5.0, 5.6, 0.30), (0, 0.2, 0.45), 0)]
out = os.path.join(K.ROOT, "previews", "audit")
os.makedirs(out, exist_ok=True)
K.set_cycles(S, samples=40, res_x=1100, res_y=620)
S.view_settings.look = 'AgX - Base Contrast'
for name, loc, tgt, oscale in views:
    c = K.make_camera(f"AUD_{name}", cams, 50)
    c.location = loc
    if oscale:
        c.data.type = 'ORTHO'; c.data.ortho_scale = oscale
    K.look_at(c, tgt)
    S.camera = c
    S.render.filepath = os.path.join(out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("AUDIT_RENDER", name)
