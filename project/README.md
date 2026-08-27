# Koenigsegg reference-match — project guide

A shot-for-shot Blender reconstruction of `reference/koenigsegg_reference.mp4`
(1920×1080, 60 fps, 16.600 s, 996 frames, 22 shots).

## Layout

```
reference/                     the source MP4 and extracted comparison frames
project/reference_analysis.md  full 22-shot breakdown; read this first
project/scene_inventory.json   every object, material and texture in the model
project/source/                the untouched model .blend (read-only, never written)
project/koenigsegg_final.blend the master scene: car, both locations, all cameras
project/scripts/               build, preview, render, verify and encode
project/previews/              preview renders and reference/render comparisons
project/renders/final/         the 1920×1080 PNG sequence
output/koenigsegg_final.mp4    the encoded film (produced by render_all.sh)
output/koenigsegg_timing_animatic.mp4   cut-timing check, see below
```

## First run

The master .blend (~175 MB) and the source model (~176 MB) both exceed
GitHub's file size limit, so neither is committed. Everything needed to
regenerate them is. One command:

```bash
bash project/scripts/bootstrap.sh
```

It fetches the Koenigsegg Jesko 2020 model (Open3DLab project
`7de202a0-9d61-4005-8f99-919fbf546349`, CC BY-NC-ND 4.0), stores it read-only
at `project/source/koenigsegg_source.blend`, and builds
`project/koenigsegg_final.blend` from the scripts. If you already have the
model, point at it instead: `KSEG_SOURCE_BLEND=/path/to/jesko.blend`.

Requires Blender 4.2 or newer on PATH (developed against 4.2.5 LTS) and ffmpeg
for encoding.

## Rendering the film

Everything is already set up in the .blend: 996 frames at 60 fps, Cycles, AgX,
motion blur, per-shot depth of field, and camera bindings on the timeline.

```bash
# One command: render, verify, encode. Resumes if interrupted -- just rerun it.
SAMPLES=256 DEVICE=GPU bash project/scripts/render_all.sh
```

Or in two steps:

```bash
blender -b -noaudio project/koenigsegg_final.blend \
  -P project/scripts/render_final.py -- --samples 256 --device GPU

bash project/scripts/encode.sh          # verifies every frame, then encodes
```

`render_final.py` writes frames one at a time and skips any that already exist,
so an interrupted render resumes where it stopped. It picks the first available
GPU backend (OptiX, CUDA, HIP, oneAPI, Metal) and falls back to CPU with a
printed notice rather than silently rendering slowly. `--force` re-renders
frames that are already present.

`verify_frames.py` checks that all 996 frames exist, are non-trivial in size and
end with a valid PNG `IEND` marker, so a half-written frame cannot reach the
encode. `encode.sh` runs it before encoding and exits if anything is missing.

**Render cost.** This is a reflective car with depth of field under path
tracing. On the CPU-only container this was developed in, one 1920×1080 frame
at 256 samples takes minutes, so the full sequence is a GPU job. Preview work
was done at 800×450 / 40 samples, roughly 25 s per frame.

## The timing animatic

`output/koenigsegg_timing_animatic.mp4` holds each shot's first frame for that
shot's exact duration: 996 frames, 60 fps, 16.600 s, the same as the reference.
It is a check on shot order and cut timing, not a render of the film -- there is
no camera movement in it. Play it against the reference to confirm the edit
lands on the same beats before committing GPU time to the real sequence.

## Rebuilding the scene

The master .blend is generated, not hand-edited. To change anything, edit the
scripts and rebuild:

```bash
blender -b -noaudio --factory-startup -P project/scripts/build_master.py
```

| script | what it does |
|---|---|
| `lib_kseg.py` | import the car, flatten the port's rig, shared helpers |
| `mat_car.py` | rebuild every car material |
| `env_common.py` | shared environment primitives and the crowd builder |
| `env_plaza.py` | the outdoor plaza, its overcast world and light rig |
| `env_hall.py` | the indoor hall, its world and light rig |
| `shots.py` | the 22-shot table: timing, lens, framing, focus |
| `build_master.py` | assembles all of the above into the master .blend |

Diagnostics used while building, kept because they are useful again:
`inspect_model.py` (writes `scene_inventory.json`), `probe_mats.py` (which
materials cover real polygons), `probe_nodes.py` (how a shader is wired),
`probe_id.py` (flat material-ID render, to trace a pixel back to its material),
`check_model.py` and `check_mats.py` (neutral-light look tests).

## Previewing shots

```bash
# every shot, first frame
blender -b -noaudio project/koenigsegg_final.blend \
  -P project/scripts/render_previews.py -- --res 800 --samples 40 --tag all --frames 0

# one shot, start / middle / end
blender -b -noaudio project/koenigsegg_final.blend \
  -P project/scripts/render_previews.py -- S05 --res 960 --samples 48

# stack the reference above the render for the same shot
project/scripts/compare.sh S05 shot 3.02 3.75 4.47 181 225 269
```

## How the shots are specified

`shots.py` does not store camera positions. Each shot gives a target point, a
bearing and elevation to the camera, and how many metres of world the frame
should span; the distance follows from the lens as `d = frame_width × focal ÷ 36`.
Hand-placed positions had put the macro cameras inside the bodywork — a 135 mm
lens at 0.9 m frames 0.24 m of world — so the framing is now correct by
construction and each shot is tuned in terms a cinematographer would use.

## Things worth knowing before changing them

- **The car is never scaled or moved.** It sits at the origin, nose toward +Y,
  left flank toward −X, tyres on Z=0. Every camera, light and environment
  assumes this.
- **Only one location renders per shot.** Object visibility is keyed per shot
  range; `Collection.hide_render` is not animatable in Blender, so it is done
  per object.
- **Bounce lights are deliberately small.** Room-sized upward area lights lit
  the crowd and the walls from below and flattened both locations into white
  voids. The fills that replaced them are local to the car.
- **The indoor look needs both light systems.** The big window key draws the
  long flank highlight; the small ceiling downlights make the crisp round
  specular dots on the bonnet. Dropping either one loses half the look.
