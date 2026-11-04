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
