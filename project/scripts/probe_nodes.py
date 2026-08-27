import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
K.purge_scene(); K.link_car()
for name in ["vehicle_paint1", "vehicle_mesh.011", "vehicle_tire.017", "vehicle_vehglass",
             "vehicle_mesh.023", "vehicle_lightsemissive.004", "vehicle_tire.014"]:
    m = bpy.data.materials.get(name)
    print(f"\n=== {name} === use_nodes={m.use_nodes if m else None} blend={getattr(m,'blend_method',None)}")
    if not m or not m.use_nodes:
        continue
    for n in m.node_tree.nodes:
        extra = ""
        if n.type == 'TEX_IMAGE' and n.image:
            extra = f" img={n.image.name} cs={n.image.colorspace_settings.name}"
        if n.type == 'BSDF_PRINCIPLED':
            vals = {k: (tuple(round(x,3) for x in n.inputs[k].default_value)
                        if hasattr(n.inputs[k].default_value, '__len__') else round(n.inputs[k].default_value,3))
                    for k in ("Base Color","Metallic","Roughness","IOR","Alpha","Coat Weight","Emission Strength")
                    if k in n.inputs}
            extra = f" {vals}"
        print(f"  [{n.type}] {n.name}{extra}")
    for l in m.node_tree.links:
        print(f"   link {l.from_node.name}.{l.from_socket.name} -> {l.to_node.name}.{l.to_socket.name}")
