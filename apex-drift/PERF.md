# Performance

Target: **60 fps with p95 frame time ≤ 16.7 ms and no frame over 50 ms after the countdown**, on "Balanced" graphics on a mid-range phone, on every biome.

## What made 2.0 lag, and what 3.0 does instead

From the 2.0.0 APK bundle:

| 2.0.0 | 3.0.0 |
|---|---|
| Physics at 120 Hz, up to **8 catch-up steps per frame**: one slow frame triggered more physics, which made the next frame slower | 60 Hz fixed step, at most 6 steps, and the frame time is clamped to 100 ms. A step costs **28 µs** (measured, below) |
| Car drawn at the raw physics position: judders at any frame rate that isn't exactly 120 Hz, the "laggy cars" | The car is **interpolated** between the last two physics states every frame (`Car.pose`) |
| PCF *soft* shadows on medium and high | One sun shadow in a tight 52 m box that follows the car, plain PCF, 1024 px on Balanced; car-only on Balanced, scenery too on Best; none on Battery saver |
| Full device pixel ratio | Pixel ratio capped per tier (0.8 / 1.0 / 1.5) **and dynamic resolution**: if the slowest 10 % of frames go over 19 ms, render scale drops in steps to 60 %; it climbs back when there's headroom |
| Scenery built as many separate meshes | Each 64 m terrain tile's scenery is merged into **one draw call**; each 120 m road segment into three |
| Shaders compiled mid-stage (first-corner hitch) | `renderer.compile()` during the loading screen, and the world around the start built before the countdown |
| — | Streaming budget: at most 2 tiles/segments built per frame, so streaming never stalls a frame |
| — | Automatic tier: the first stage measures the flyover and picks a tier; it's stored and can be overridden in Options |

## Measured here

Node 22 on the development container (single core, no GPU):

| What | Cost |
|---|---|
| Physics step including the test autopilot | **28 µs** (60 steps/s ≈ 1.7 ms per second of play) |
| Building a 12.2 km stage (route + ground + leg clearances) | 110 ms, behind the loading screen |
| Planning one 64 m scenery tile | 0.4 ms, ~70 objects |
| Production bundle | 5.2 MB total; JS 187 KB gzip (three.js is most of it) |

The headless browser here renders WebGL in software (SwiftShader), so **GPU frame times can't be measured in this container**. Those numbers have to come from phones, using the overlay below.

## Measuring on a phone

1. Install the APK. Options → Data → tap the **version line five times**. An overlay shows the rolling p50 / p95 / worst frame time, draw calls, triangles, the graphics tier and the current render scale.
2. For each biome, drive the first stage for two minutes on Balanced and note p95 and the worst frame: Finland (forest), Kenya (open savannah), Wales (rain), Japan (dense cedar, rain), Sweden (snow, night), Riviera Alps (night, tarmac).
3. Repeat the heaviest one on Battery saver and on Best.
4. Chrome remote debugging (`chrome://inspect` with USB debugging) works on debug builds; release builds have WebView debugging switched off.

Fill in this table and commit it:

| Phone | Tier | Stage | p50 ms | p95 ms | worst ms | draws | scale |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## The bigger world (3.1)

Stages are 1.3-1.9x longer and the visible world reaches 560 / 560 / 1250 m (Battery saver / Balanced / Best) instead of ending at 260-420 m. What keeps that affordable:

| Piece | Cost and how it is held down |
|---|---|
| Far terrain | 256 m chunks on a 16 m grid, one draw call each, built one per frame. Plain vertex-colour material (no textures), drawn after the near world so the depth test discards what tiles and trees cover. Which cells show is an index rewrite when a detailed tile comes or goes, never a rebuild |
| Distant forest | Cones and domes merged into the chunk (no extra draw call); Best only |
| Detailed tiles | Grid spacing per tile from its distance to the road: 1/2/4 m on Best, 2/2/4 on Balanced, 2/4/4 on Battery saver (coarser than 3.0 away from the road) |
| Terrain sampling | One nearest-road search per vertex instead of four, and a 64 m distance map so far terrain skips the search entirely |
| Foliage cards | Alpha-tested leaf and needle cards on Balanced and Best (they cast no shadows); grass cards on Best only (fill rate) |
| Trees | The fuller models (more tiers and clumps, limbs, root flares) on Best only |
| Film pass | Bloom is a bright pass and two blur passes at quarter resolution (plus an eighth-resolution level on Best), replacing a 16-tap ring at full resolution |

Measured in this container (SwiftShader, 915x412, machine shared with other jobs at load 8-20, so treat every number as a rough before/after on the same machine). Balanced: minimum of 12 synchronous renders; Battery saver: best p50 frame of three interleaved runs.

| Tier | Stage | 3.0 | 3.1 | 3.0 draws / tris | 3.1 draws / tris |
|---|---|---|---|---|---|
| Balanced | Finland 1 | 1391 ms | 1568 ms | 341 / 254k | 435 / 372k |
| Balanced | Wales 1 | 1249 ms | 1300-2000 ms (noisy) | 340 / 389k | 419 / 444k |
| Battery saver | Finland 1 | 199 ms | 267 ms | 191 / 139k | 203 / 127k |
| Battery saver | Wales 1 | 217 ms | 300 ms | 186 / 182k | 182 / 156k |
| Battery saver | Japan 1 | 250 ms | 217 ms | 206 / 256k | 190 / 162k |
| Battery saver | Monte 1 | 217 ms | 274 ms | 166 / 112k | 226 / 213k |

Title to the driving school's "running" phase on Balanced, same load: 3.0 124 s, 3.1 137 s. Building a 21 km stage (route and ground): about 100 ms.
