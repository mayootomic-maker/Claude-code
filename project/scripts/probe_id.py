"""Flat material-ID render: every material becomes a unique emission colour so
a pixel in the beauty render can be traced back to the material that made it."""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
import mat_car

K.purge_scene(); S = bpy.context.scene
K.link_car(); mat_car.apply_all(verbose=False)

mats = sorted({s.material.name for o in K.car_objects() for s in o.material_slots if s.material})
legend = {}
for i, name in enumerate(mats):
    m = bpy.data.materials[name]
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    # Base-6 digits give 216 distinguishable flat colours.
    c = ((i % 6) / 5.0, ((i // 6) % 6) / 5.0, ((i // 36) % 6) / 5.0)
    e.inputs["Color"].default_value = (*c, 1)
    e.inputs["Strength"].default_value = 1.0
    nt.links.new(e.outputs["Emission"], out.inputs["Surface"])
    m.blend_method = 'OPAQUE'
    legend[name] = [round(v, 3) for v in c]

w = bpy.data.worlds.new("w"); S.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 0.0

cams = K.new_collection("C")
c = K.make_camera("ID", cams, 60)
c.location = (4.6, 5.6, 1.35); K.look_at(c, (0, 0.9, 0.55))
S.camera = c
K.set_cycles(S, samples=1, res_x=960, res_y=540, denoise=False)
S.view_settings.view_transform = 'Standard'
S.cycles.max_bounces = 0
out = os.path.join(K.ROOT, "previews", "id")
os.makedirs(out, exist_ok=True)
S.render.filepath = os.path.join(out, "id.png")
bpy.ops.render.render(write_still=True)
json.dump(legend, open(os.path.join(out, "legend.json"), "w"), indent=1)
print("ID_OK", len(mats))
