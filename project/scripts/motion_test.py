"""Render a continuous run of frames from one shot, so camera movement can be
watched rather than inferred from stills.

  blender -b -noaudio project/koenigsegg_final.blend \
      -P project/scripts/motion_test.py -- S02 [--res 480] [--samples 16] [--step 1]

Writes project/previews/motion/<SHOT>/ and prints the ffmpeg command to encode
it. Deliberately cheap: this is for judging motion, not quality.
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
root = os.path.dirname(os.path.abspath(bpy.data.filepath))
sys.path.insert(0, os.path.join(root, "scripts"))
import shots as SH

shot, res, samples, step = "S02", 480, 16, 1
i = 0
while i < len(argv):
    if argv[i] == "--res":
        res = int(argv[i + 1]); i += 2
    elif argv[i] == "--samples":
        samples = int(argv[i + 1]); i += 2
    elif argv[i] == "--step":
        step = int(argv[i + 1]); i += 2
    else:
        shot = argv[i]; i += 1

a, b = [(x, y) for n, x, y in SH.RANGES if n == shot][0]
S = bpy.context.scene
S.cycles.samples = samples
S.render.resolution_x = res
S.render.resolution_y = int(res * 9 / 16)
S.camera = bpy.data.objects[f"{shot}_CAM"]

outdir = os.path.join(root, "previews", "motion", shot)
os.makedirs(outdir, exist_ok=True)
n = 0
for f in range(a, b + 1, step):
    S.frame_set(f)
    S.camera = bpy.data.objects[f"{shot}_CAM"]
    S.render.filepath = os.path.join(outdir, f"{n:04d}")
    bpy.ops.render.render(write_still=True)
    n += 1
    print(f"MOTION {shot} frame {f} ({n})", flush=True)

print(f"MOTION_DONE {shot} frames={n} dir={outdir}")
print(f"  ffmpeg -framerate {60 // step} -i {outdir}/%04d.png "
      f"-c:v libx264 -crf 18 -pix_fmt yuv420p {outdir}.mp4 -y")
