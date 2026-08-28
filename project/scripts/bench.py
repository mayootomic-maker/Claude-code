import bpy, time, math, sys
S = bpy.context.scene
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene

# a reflective, car-like blob + ground + area lights + DOF: representative of the real workload
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.2, location=(0,0,1.2), segments=64, ring_count=32)
car = bpy.context.object
bpy.ops.object.shade_smooth()
m = bpy.data.materials.new("paint"); m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.08,0.02,0.12,1)
b.inputs["Metallic"].default_value = 0.9
b.inputs["Roughness"].default_value = 0.18
b.inputs["Coat Weight"].default_value = 1.0
car.data.materials.append(m)

bpy.ops.mesh.primitive_plane_add(size=60)
g = bpy.context.object
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.25
g.data.materials.append(gm)

for i,(x,y,z,sx,sy) in enumerate([(-6,-2,6,10,3),(6,-1,5,8,2.5),(0,7,5,12,4)]):
    bpy.ops.object.light_add(type='AREA', location=(x,y,z))
    L = bpy.context.object; L.data.shape='RECTANGLE'; L.data.size=sx; L.data.size_y=sy
    L.data.energy = 2000
    L.rotation_euler = (math.radians(50), 0, math.radians(i*40))

bpy.ops.object.camera_add(location=(6,-7,1.6), rotation=(math.radians(85),0,math.radians(40)))
cam = bpy.context.object; S.camera = cam
cam.data.lens = 85
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = 9.0
cam.data.dof.aperture_fstop = 2.2

S.render.engine = 'CYCLES'
S.cycles.device = 'CPU'
S.cycles.samples = int(sys.argv[-2])
S.cycles.use_denoising = True
S.render.resolution_x = int(sys.argv[-1]); S.render.resolution_y = int(int(sys.argv[-1])*9/16)
S.render.resolution_percentage = 100
S.render.filepath = '/tmp/bench_'
S.frame_set(1)
t0=time.time()
bpy.ops.render.render(write_still=True)
print(f"BENCHRESULT samples={S.cycles.samples} res={S.render.resolution_x}x{S.render.resolution_y} seconds={time.time()-t0:.1f}")
