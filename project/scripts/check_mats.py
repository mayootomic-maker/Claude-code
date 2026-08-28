"""Render the material rebuild under neutral light plus a hard specular row,
so the paint, weave, stripe, carbon, glass and metals can be judged directly."""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
import mat_car

K.purge_scene()
S = bpy.context.scene
K.link_car()
mat_car.apply_all()

world = bpy.data.worlds.new("w"); S.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.50, 0.53, 0.60, 1); bg.inputs[1].default_value = 1.0

L = K.new_collection("L")
K.area_light("key", L, (-5.5, 3.5, 4.5), (math.radians(50), 0, math.radians(-38)), 9, 2.5, 4000)
K.area_light("fill", L, (6.5, -1.5, 4.0), (math.radians(55), 0, math.radians(148)), 8, 2.5, 1500)
K.area_light("rim", L, (0, -7.5, 3.5), (math.radians(68), 0, math.radians(180)), 10, 2.0, 1800)
# A row of small round sources: the reference's indoor downlights are what
# make the paint read as expensive, so the check has to include them.
for i in range(5):
    d = bpy.data.lights.new(f"dl{i}", type='POINT'); d.energy = 320; d.shadow_soft_size = 0.06
    o = bpy.data.objects.new(f"dl{i}", d); o.location = (-1.2, 2.6 - i * 1.3, 3.2)
    L.objects.link(o)

bpy.ops.mesh.primitive_plane_add(size=90)
g = bpy.context.object
gm, nt, b = K.new_material("chk_ground")
b.inputs["Base Color"].default_value = (0.16, 0.16, 0.17, 1)
b.inputs["Roughness"].default_value = 0.28
g.data.materials.append(gm)

cams = K.new_collection("C")
views = [
    ("paint34",  (4.6, 5.6, 1.35), 60,  (0, 0.9, 0.55), 8.0, 4.0),
    ("bonnet",   (1.05, 3.05, 1.02), 135, (0.30, 2.05, 0.36), 1.3, 2.4),
    ("flank",    (3.35, -0.55, 0.62), 120, (1.02, -0.50, 0.46), 2.4, 2.4),
    ("wheelmac", (2.55, 1.30, 0.42), 110, (0.97, 1.30, 0.30), 1.6, 2.4),
    ("rear34",   (4.2, -5.4, 1.30), 55,  (0, -1.2, 0.55), 7.2, 4.0),
    ("glass",    (2.75, 1.15, 1.30), 85,  (0.35, 0.62, 0.72), 2.6, 2.8),
    ("stripe",   (0.0, 5.2, 1.55), 70,  (0.0, 1.6, 0.42), 3.9, 5.6),
    ("stripetop",(0.0, 2.6, 2.10), 55,  (0.0, 0.6, 0.55), 2.6, 6.0),
]
outdir = os.path.join(K.ROOT, "previews", "mat_check")
os.makedirs(outdir, exist_ok=True)
K.set_cycles(S, samples=64, res_x=960, res_y=540)

for name, loc, lens, tgt, fdist, fstop in views:
    c = K.make_camera(f"MC_{name}", cams, lens)
    c.location = loc
    K.look_at(c, tgt)
    c.data.dof.use_dof = True
    c.data.dof.focus_distance = fdist
    c.data.dof.aperture_fstop = fstop
    S.camera = c
    S.render.filepath = os.path.join(outdir, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)
