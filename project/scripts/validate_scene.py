"""Structural check on the built master scene.

  blender -b -noaudio project/koenigsegg_final.blend -P project/scripts/validate_scene.py

Exits non-zero on any failure, so it can gate a render.
"""
import bpy, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bpy.data.filepath)), "scripts"))
import shots as SH
S = bpy.context.scene
ok = True
def chk(label, cond, detail=""):
    global ok
    print(f"{'PASS' if cond else 'FAIL'}  {label} {detail}")
    ok = ok and cond

chk(f"frame range 1-{SH.LAST_FRAME}", (S.frame_start, S.frame_end) == (SH.FIRST_FRAME, SH.LAST_FRAME), f"{S.frame_start}-{S.frame_end}")
chk("fps 60", S.render.fps == 60, str(S.render.fps))
chk("resolution 1920x1080", (S.render.resolution_x, S.render.resolution_y) == (1920, 1080))
chk("engine Cycles", S.render.engine == 'CYCLES', S.render.engine)
chk("view transform AgX", S.view_settings.view_transform == 'AgX', S.view_settings.view_transform)
chk("motion blur on", S.render.use_motion_blur)
chk("PNG output", S.render.image_settings.file_format == 'PNG')

marks = {m.frame: (m.name, m.camera.name if m.camera else None) for m in S.timeline_markers}
chk("22 camera markers", len(marks) == 22, str(len(marks)))
for n, a, b in SH.RANGES:
    if a not in marks or marks[a][1] != f"{n}_CAM":
        chk(f"marker {n}@{a}", False, str(marks.get(a)))
        break
else:
    chk("every shot bound to its camera at its first frame", True)

missing = [n for n, _, _ in SH.RANGES if not bpy.data.objects.get(f"{n}_CAM")]
chk("22 cameras exist", not missing, str(missing))
nodof = [n for n, _, _ in SH.RANGES
         if not bpy.data.objects[f"{n}_CAM"].data.dof.use_dof
         or bpy.data.objects[f"{n}_CAM"].data.dof.focus_object is None]
chk("every camera has DOF with an explicit focus target", not nodof, str(nodof))

# Visibility: at one frame per location, the other location must be hidden.
def hidden_count(coll_name, frame):
    S.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    c = bpy.data.collections[coll_name]
    vis = [o for o in c.all_objects if not o.evaluated_get(dg).hide_render]
    return len(vis), len(list(c.all_objects))
hall_first = [a for n, a, b in SH.RANGES if SH.SHOTS[n]["loc"] == "hall"][0]
black_first = [a for n, a, b in SH.RANGES if SH.SHOTS[n]["loc"] == "black"][0]
for frame, on, off in ((1, "ENV_PLAZA", "ENV_HALL"), (hall_first, "ENV_HALL", "ENV_PLAZA")):
    v_on, t_on = hidden_count(on, frame)
    v_off, _ = hidden_count(off, frame)
    chk(f"frame {frame}: {on} visible, {off} hidden", v_on == t_on and v_off == 0,
        f"{on}={v_on}/{t_on} {off}={v_off}")
v, t = hidden_count("KOENIGSEGG", black_first + 2)
chk("car hidden during the black outro", v == 0, f"visible={v}")

door = bpy.data.objects.get("door_dside_f")
piv = bpy.data.objects.get("DOOR_L_PIVOT")
chk("door pivot exists and drives the door", piv is not None and door.parent is piv)
S.frame_set(1);  closed = tuple(round(a, 3) for a in piv.rotation_euler)
S20a = [a for n, a, b in SH.RANGES if n == "S20"][0]
S.frame_set(S20a + 5); opened = tuple(round(a, 3) for a in piv.rotation_euler)
chk("door closed at frame 1, open during S20", closed == (0.0, 0.0, 0.0) and opened != closed,
    f"{closed} -> {opened}")

print("VALIDATION", "OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
