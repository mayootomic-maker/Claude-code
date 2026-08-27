"""Render preview frames from the master scene.

  blender -b koenigsegg_final.blend -P render_previews.py -- S01 [S02 ...] \
      [--res 960] [--samples 64] [--frames a,b,c] [--tag name]

With no shot names, renders the representative frames of every shot.
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
sys.path.insert(0, os.path.dirname(os.path.abspath(bpy.data.filepath)) + "/scripts")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(bpy.data.filepath)), "scripts"))
import shots as SH

res = 960
samples = 64
explicit_frames = None
tag = "shot"
names = []
i = 0
while i < len(argv):
    a = argv[i]
    if a == "--res":
        res = int(argv[i + 1]); i += 2
    elif a == "--samples":
        samples = int(argv[i + 1]); i += 2
    elif a == "--frames":
        explicit_frames = [int(x) for x in argv[i + 1].split(",")]; i += 2
    elif a == "--tag":
        tag = argv[i + 1]; i += 2
    else:
        names.append(a); i += 1

if not names:
    names = [n for n, _, _ in SH.RANGES]

S = bpy.context.scene
S.cycles.samples = samples
S.render.resolution_x = res
S.render.resolution_y = int(res * 9 / 16)
S.render.resolution_percentage = 100

root = os.path.dirname(os.path.abspath(bpy.data.filepath))
outdir = os.path.join(root, "previews", tag)
os.makedirs(outdir, exist_ok=True)

cams = {n: bpy.data.objects.get(f"{n}_CAM") for n, _, _ in SH.RANGES}
rng = {n: (a, b) for n, a, b in SH.RANGES}

for name in names:
    a, b = rng[name]
    frames = explicit_frames or [a, (a + b) // 2, b]
    for f in frames:
        f = max(a, min(b, f))
        S.frame_set(f)
        S.camera = cams[name]
        S.render.filepath = os.path.join(outdir, f"{name}_{f:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"PREVIEW {name} frame {f}")
