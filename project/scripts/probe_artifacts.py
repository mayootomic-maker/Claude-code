"""Render a beauty pass and a material-ID pass from the same camera, then name
the materials responsible for colours the reference does not contain.

Both passes come from one run so they are always aligned and always current --
comparing a fresh ID pass against a stale beauty render is how an already-fixed
material got blamed twice.
"""
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
import mat_car

out = os.path.join(K.ROOT, "previews", "artifacts")
os.makedirs(out, exist_ok=True)


def scene(with_real_materials):
    K.purge_scene()
    S = bpy.context.scene
    K.link_car()
    if with_real_materials:
        mat_car.apply_all(verbose=False)
        w = bpy.data.worlds.new("w"); S.world = w; w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.47, 0.52, 1)
        L = K.new_collection("L")
        K.area_light("k", L, (-5, 3.5, 4.5), (math.radians(50), 0, math.radians(-38)), 9, 3, 2600)
        K.area_light("f", L, (5.5, -2, 4), (math.radians(55), 0, math.radians(148)), 8, 3, 1200)
        legend = None
    else:
        mats = sorted({s.material.name for o in K.car_objects()
                       for s in o.material_slots if s.material})
        legend = {}
        for i, name in enumerate(mats):
            m = bpy.data.materials[name]
            m.use_nodes = True
            nt = m.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            o = nt.nodes.new("ShaderNodeOutputMaterial")
            e = nt.nodes.new("ShaderNodeEmission")
            c = ((i % 6) / 5.0, ((i // 6) % 6) / 5.0, ((i // 36) % 6) / 5.0)
            e.inputs["Color"].default_value = (*c, 1)
            nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
            m.blend_method = 'OPAQUE'
            legend[name] = [round(v, 3) for v in c]
        w = bpy.data.worlds.new("w"); S.world = w; w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[1].default_value = 0.0

    cams = K.new_collection("C")
    c = K.make_camera("PROBE", cams, 85)
    c.location = (-3.05, 1.35, 0.55)
    K.look_at(c, (-0.85, 0.9, 0.35))
    S.camera = c
    K.set_cycles(S, samples=(40 if with_real_materials else 1),
                 res_x=960, res_y=540, denoise=with_real_materials)
    if not with_real_materials:
        S.view_settings.view_transform = 'Standard'
        S.cycles.max_bounces = 0
    S.render.filepath = os.path.join(out, "beauty.png" if with_real_materials else "id.png")
    bpy.ops.render.render(write_still=True)
    return legend


# Each pass runs in its own Blender process. Doing both in one session appends
# the car twice, so the second copy's materials come in as name.001, name.002
# and the ID legend no longer refers to the materials anyone can edit.
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = argv[0] if argv else "beauty"
legend = scene(mode == "beauty")
if legend is not None:
    json.dump(legend, open(os.path.join(out, "legend.json"), "w"), indent=1)
print("ARTIFACT_PROBE_OK", mode)
