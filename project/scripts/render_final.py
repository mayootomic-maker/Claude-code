"""Final render: 1920x1080, 60 fps, Cycles, lossless PNG sequence, resumable.

  blender -b project/koenigsegg_final.blend -P project/scripts/render_final.py \
      -- [--samples 256] [--start 1] [--end 996] [--device GPU|CPU] [--force]

Frames already present in project/renders/final are skipped unless --force is
given, so an interrupted render resumes instead of starting over. Frames are
written one at a time rather than through Blender's animation renderer, which
is what makes resuming possible.
"""
import bpy, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
samples, start, end, device, force = 256, None, None, "GPU", False
i = 0
while i < len(argv):
    a = argv[i]
    if a == "--samples":
        samples = int(argv[i + 1]); i += 2
    elif a == "--start":
        start = int(argv[i + 1]); i += 2
    elif a == "--end":
        end = int(argv[i + 1]); i += 2
    elif a == "--device":
        device = argv[i + 1].upper(); i += 2
    elif a == "--force":
        force = True; i += 1
    else:
        i += 1

S = bpy.context.scene
root = os.path.dirname(os.path.abspath(bpy.data.filepath))
outdir = os.path.join(root, "renders", "final")
os.makedirs(outdir, exist_ok=True)

S.render.resolution_x = 1920
S.render.resolution_y = 1080
S.render.resolution_percentage = 100
S.render.fps = 60
S.cycles.samples = samples
S.render.image_settings.file_format = 'PNG'
S.render.image_settings.color_mode = 'RGB'
S.render.image_settings.color_depth = '8'
S.render.image_settings.compression = 15

if device == "GPU":
    prefs = bpy.context.preferences.addons.get("cycles")
    enabled = False
    if prefs:
        cp = prefs.preferences
        for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                cp.compute_device_type = backend
            except TypeError:
                continue
            cp.get_devices()
            devs = [d for d in cp.devices if d.type == backend]
            if devs:
                for d in cp.devices:
                    d.use = (d.type == backend)
                enabled = True
                print(f"RENDER_DEVICE {backend} ({len(devs)} device(s))")
                break
    S.cycles.device = 'GPU' if enabled else 'CPU'
    if not enabled:
        print("RENDER_DEVICE CPU (no GPU backend available)")
else:
    S.cycles.device = 'CPU'
    print("RENDER_DEVICE CPU (requested)")

first = start or S.frame_start
last = end or S.frame_end

todo = []
for f in range(first, last + 1):
    path = os.path.join(outdir, f"f_{f:04d}.png")
    # A frame still being written has no valid PNG end-of-file marker; treat
    # anything suspiciously small as missing so a killed render is redone.
    if force or not os.path.exists(path) or os.path.getsize(path) < 4096:
        todo.append(f)

print(f"RENDER_PLAN total={last - first + 1} todo={len(todo)} samples={samples} "
      f"device={S.cycles.device}")

t0 = time.time()
for n, f in enumerate(todo, 1):
    S.frame_set(f)
    S.render.filepath = os.path.join(outdir, f"f_{f:04d}")
    bpy.ops.render.render(write_still=True)
    el = time.time() - t0
    print(f"FRAME_DONE {f} ({n}/{len(todo)}) elapsed={el:.0f}s "
          f"avg={el / n:.1f}s/frame eta={(len(todo) - n) * el / n / 60:.1f}min",
          flush=True)

print(f"RENDER_COMPLETE rendered={len(todo)} seconds={time.time() - t0:.0f}")
