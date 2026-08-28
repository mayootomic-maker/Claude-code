"""Build project/koenigsegg_final.blend: one master scene holding the car,
both environments, both light rigs and all 22 shot cameras.

Run:  blender -b -noaudio --factory-startup -P build_master.py
The source .blend is never modified; everything is appended from it.
"""
import bpy, sys, os, math
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_kseg as K
import mat_car
import env_common as E
import env_plaza
import env_hall
import shots as SH

OUT = os.path.join(K.ROOT, "koenigsegg_final.blend")


def _visibility_keys(on_ranges):
    """Frames at which visibility flips, and the state after each flip.
    Collection.hide_render is not animatable in Blender, so this is applied
    per object instead."""
    state = {f: False for f in range(SH.FIRST_FRAME, SH.LAST_FRAME + 1)}
    for a, b in on_ranges:
        for f in range(a, b + 1):
            state[f] = True
    keys = [(SH.FIRST_FRAME, state[SH.FIRST_FRAME])]
    for f in range(SH.FIRST_FRAME + 1, SH.LAST_FRAME + 1):
        if state[f] != state[f - 1]:
            keys.append((f, state[f]))
    return keys


def _keyframe_collection_visibility(coll, on_ranges):
    """Switch every object in a collection on and off per shot range, so only
    the location a shot was filmed in is ever in the render."""
    keys = _visibility_keys(on_ranges)
    # Snapshot: keyframing mutates the depsgraph, and iterating all_objects
    # live while doing so is what crashed Blender here. Only hide_render is
    # keyed -- it is the flag that governs renders, and touching hide_viewport
    # as well forced a full depsgraph rebuild per key.
    objects = list(coll.all_objects)
    for ob in objects:
        if ob.animation_data is None:
            ob.animation_data_create()
        act = ob.animation_data.action
        if act is None:
            act = bpy.data.actions.new(f"{ob.name}_vis")
            ob.animation_data.action = act
        fc = act.fcurves.find("hide_render")
        if fc is None:
            fc = act.fcurves.new("hide_render")
        fc.keyframe_points.add(len(keys))
        for i, (f, on) in enumerate(keys):
            kp = fc.keyframe_points[i]
            kp.co = (float(f), 0.0 if on else 1.0)
            kp.interpolation = 'CONSTANT'
        fc.update()
        ob.hide_render = not keys[0][1]


def _open_door():
    """Pose the driver's dihedral door raised for S20.

    A Koenigsegg door swings out and up on a synchro-helix arm. Rotating the
    panel about a pivot at the front-lower hinge reproduces the shape the
    reference shows across the top of frame without modelling the mechanism.
    """
    door = bpy.data.objects.get("door_dside_f")
    if not door:
        return None
    from mathutils import Matrix
    hinge = Vector((-0.72, 0.98, 0.50))   # model space, before the ground lift

    piv = bpy.data.objects.new("DOOR_L_PIVOT", None)
    piv.empty_display_type = 'ARROWS'
    piv.empty_display_size = 0.3
    bpy.data.collections["KOENIGSEGG"].objects.link(piv)
    # Sits under KSEG_ROOT so it inherits the ground lift with the rest of the
    # car. Both inverses are written explicitly instead of read back from
    # matrix_world, which is stale until the depsgraph has evaluated and once
    # left the door hanging open in every shot.
    root = bpy.data.objects.get("KSEG_ROOT")
    piv.parent = root
    piv.matrix_parent_inverse = Matrix.Identity(4)
    piv.location = hinge

    door.parent = piv
    door.matrix_parent_inverse = Matrix.Translation(-hinge)
    bpy.context.view_layer.update()

    a, b = SH.RANGES[19][1], SH.RANGES[19][2]   # S20
    closed = (0.0, 0.0, 0.0)
    opened = (math.radians(-6.0), math.radians(-58.0), math.radians(-16.0))
    for f, rot in ((SH.FIRST_FRAME, closed), (a, opened), (b, opened),
                   (min(b + 1, SH.LAST_FRAME), closed)):
        piv.rotation_euler = rot
        piv.keyframe_insert("rotation_euler", frame=f)
    if piv.animation_data and piv.animation_data.action:
        for fc in piv.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'
    return piv


def _black_card(coll):
    """S22 is a flat near-black hold measuring about 6/255, not pure black."""
    m = E._mat("OUTRO_black", None, 0, emit=(1, 1, 1), emit_str=0.0072)
    p = E.plane("OUTRO_CARD", coll, 6, 6, (0, 0, 39.0),
                rotation=(0, 0, 0), material=m)
    return p


def _build_cameras():
    cams = K.new_collection("CAMERAS")
    focus = K.new_collection("FOCUS")
    scene = bpy.context.scene
    made = []

    for name, a, b in SH.RANGES:
        s = SH.SHOTS[name]

        aim = bpy.data.objects.new(f"{name}_FOCUS", None)
        aim.empty_display_type = 'SPHERE'
        aim.empty_display_size = 0.06
        focus.objects.link(aim)
        aim.location = s["tgt"]
        # Two keys so the aim gets an F-curve for the drift modifier below.
        for f in (a, b):
            aim.keyframe_insert("location", frame=f)

        cam = K.make_camera(f"{name}_CAM", cams, s["lens"])
        cam.data.dof.use_dof = True
        cam.data.dof.aperture_fstop = s["fstop"]
        cam.data.dof.focus_object = aim
        cam.data.dof.aperture_blades = 8
        if "shift" in s:
            cam.data.shift_x, cam.data.shift_y = s["shift"]

        for f, p in SH.move_keys(name, a, b):
            cam.location = p
            cam.keyframe_insert("location", frame=f)

        # Smooth through the intermediate samples, easing only at the ends.
        # AUTO_CLAMPED everywhere flattens each key into a little plateau and
        # the move visibly stutters; AUTO keeps the middle continuous.
        act = cam.animation_data.action
        for fc in act.fcurves:
            pts = fc.keyframe_points
            for j, kp in enumerate(pts):
                kp.interpolation = 'BEZIER'
                edge = (j == 0 or j == len(pts) - 1)
                kp.handle_left_type = kp.handle_right_type = (
                    'AUTO_CLAMPED' if edge else 'AUTO')
            fc.update()

        # Handheld float. Slow and shallow: the first pass ran the noise at
        # about a 0.4 s period, which reads as buzz rather than as a person
        # holding a camera. Real hand-held drift is well under 1 Hz.
        seed = sum(ord(c) for c in name)
        if s["shake"] > 0:
            for i, fc in enumerate(act.fcurves):
                n = fc.modifiers.new('NOISE')
                n.scale = 115.0 + i * 23.0
                n.strength = s["shake"] * 0.85
                n.phase = 5.1 * (i + 1) + seed % 23
                n.depth = 0
            # Drift the aim too. With the camera locked to the target by a
            # Track To constraint, a perfectly still aim point makes the move
            # feel motorised no matter what the body is doing.
            aim_act = aim.animation_data.action
            drift = min(0.9 * s["shake"], 0.010) * (1.0 if s["lens"] < 100 else 0.35)
            for i, fc in enumerate(aim_act.fcurves):
                n = fc.modifiers.new('NOISE')
                n.scale = 165.0 + i * 31.0
                n.strength = drift
                n.phase = 2.3 * (i + 1) + seed % 19
                n.depth = 0

        con = cam.constraints.new('TRACK_TO')
        con.target = aim
        con.track_axis = 'TRACK_NEGATIVE_Z'
        con.up_axis = 'UP_Y'

        made.append((name, cam, a, b))

    # Bind each camera to its range with timeline markers.
    for name, cam, a, b in made:
        mk = scene.timeline_markers.new(name, frame=a)
        mk.camera = cam
    scene.camera = made[0][1]
    return cams, focus, made


def main():
    K.purge_scene()
    scene = bpy.context.scene

    # --- car -------------------------------------------------------------
    K.link_car()
    mat_car.apply_all()

    # --- environments ----------------------------------------------------
    plaza = env_plaza.build()
    plaza_rig = env_plaza.lights()
    hall = env_hall.build()
    hall_rig = env_hall.lights()

    outro = K.new_collection("OUTRO")
    _black_card(outro)

    car = bpy.data.collections["KOENIGSEGG"]

    plaza_ranges = [(a, b) for _, a, b in SH.ranges_by_loc("plaza")]
    hall_ranges = [(a, b) for _, a, b in SH.ranges_by_loc("hall")]
    black_ranges = [(a, b) for _, a, b in SH.ranges_by_loc("black")]
    car_ranges = plaza_ranges + hall_ranges

    _open_door()

    for coll, rng in ((plaza, plaza_ranges), (plaza_rig, plaza_ranges),
                      (hall, hall_ranges), (hall_rig, hall_ranges),
                      (car, car_ranges), (outro, black_ranges)):
        _keyframe_collection_visibility(coll, rng)

    # --- cameras ---------------------------------------------------------
    _build_cameras()

    # --- world -----------------------------------------------------------
    # Two worlds are needed; the scene world is switched per location by
    # keyframing which one is active is not possible, so the plaza dome is the
    # scene world and the hall is sealed well enough that it barely leaks in.
    env_hall.world()
    scene.world = env_plaza.world()

    # --- scene settings ---------------------------------------------------
    K.set_cycles(scene, samples=256, res_x=1920, res_y=1080)
    scene.frame_start = SH.FIRST_FRAME
    scene.frame_end = SH.LAST_FRAME
    scene.render.fps = SH.FPS
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 15
    scene.render.filepath = os.path.join(K.ROOT, "renders", "final", "f_")

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("MASTER_SAVED", OUT)
    print("STATS objects=%d materials=%d frames=%d-%d" % (
        len(bpy.data.objects), len(bpy.data.materials),
        scene.frame_start, scene.frame_end))


main()
