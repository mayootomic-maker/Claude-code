"""Render four neutral views of the imported car so its real condition can be
judged visually rather than inferred from the inventory."""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K

K.purge_scene()
S = bpy.context.scene
coll, root = K.link_car()
print("LINKED", len(K.car_objects()), "mesh objects")

# Neutral soft studio: a bright dome plus three big strips, so the body shape
# reads without any of the reference's specific lighting design.
world = bpy.data.worlds.new("check")
S.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.55, 0.57, 0.62, 1)
bg.inputs[1].default_value = 1.2

lights = K.new_collection("CHECK_LIGHTS")
K.area_light("k1", lights, (-6, 3, 5), (math.radians(52), 0, math.radians(-35)), 8, 3, 3000)
K.area_light("k2", lights, (6, -2, 5), (math.radians(52), 0, math.radians(150)), 8, 3, 2000)
K.area_light("k3", lights, (0, -8, 4), (math.radians(65), 0, math.radians(180)), 10, 3, 1500)

bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
g = bpy.context.object
gm, nt, b = K.new_material("check_ground")
b.inputs["Base Color"].default_value = (0.18, 0.18, 0.19, 1)
b.inputs["Roughness"].default_value = 0.35
g.data.materials.append(gm)

cams = K.new_collection("CHECK_CAMS")
views = [
    ("front34", (5.2, 6.4, 1.5), 50),
    ("side",    (8.5, 0.0, 1.1), 55),
    ("rear34",  (5.0, -6.6, 1.5), 50),
    ("wheel",   (3.0, 1.35, 0.45), 100),
]
os.makedirs(os.path.join(K.ROOT, "previews", "model_check"), exist_ok=True)
K.set_cycles(S, samples=48, res_x=960, res_y=540)

for name, loc, lens in views:
    cam = K.make_camera(f"CHK_{name}", cams, lens)
    cam.location = loc
    tgt = (0, 1.3, 0.4) if name == "wheel" else (0, 0, 0.6)
    K.look_at(cam, tgt)
    S.camera = cam
    S.render.filepath = os.path.join(K.ROOT, "previews", "model_check", name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)
