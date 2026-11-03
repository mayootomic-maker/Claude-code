# Apex Drift 3.0: the release build

Paste everything below the line into a new Claude Code session that has the
**Apex Drift source repository** attached. The 2.0.0 APK only contains the
minified bundle (`assets/www/js/app.js`, 883 KB), so v3 can't be built from
the APK alone.

How this prompt was written: the conversation that built 2.0 isn't available
in this session. Everything under "What 2.0.0 is" was read out of
`ApexDrift-2.0.0.apk` (manifest, bundle, assets, privacy page). Lines marked
*hypothesis* are suspected causes to confirm in the source, not confirmed facts.

---

## Goal

Ship **Apex Drift 3.0.0** to Google Play as the first public release. This is
the last version before launch. It has to run smoothly on a mid-range phone,
it has to be fair and fun for someone who has never played a rally game, and
it has to clear every Play Console requirement on the first submission.
Don't add features. Fix, polish and prepare it for release.

## What 2.0.0 is (from the APK)

- Package `com.tomicstudios.apexdrift`, versionCode 4, versionName 2.0.0,
  minSdk 26, targetSdk/compileSdk 36, AGP 8.7.3, landscape-only, signed with
  APK Signature Scheme v2 (no v1).
- Native shell: a single `MainActivity` (13 KB dex) hosting a `WebView` that
  serves `https://appassets.androidplatform.net/assets/www/index.html`
  through `WebViewAssetLoader`. It exposes an `addJavascriptInterface` bridge
  (vibration, immersive mode) and sets
  `setMediaPlaybackRequiresUserGesture`.
- Game: Three.js r170, one ES-module bundle. Physics runs at a fixed
  **120 Hz with up to 8 substeps per frame** (`advance()` clamps dt to 0.25 s).
  Renderer has quality `auto/low/medium/high`, `powerPreference:
  "high-performance"`, PCF soft shadows (off only on `low`), instanced
  grass/scatter with a radius of 40–54 m.
- Content: 12 rallies (Monte Carlo, Sweden, Kenya, Croatia, Portugal,
  Sardinia, Greece/Acropolis, Estonia, Finland, Japan, Wales, Argentina) with 4
  stages each = 48 stages, plus "Poly" fantasy tracks (Park, Ribbon, Knot).
  Cars are fictional (Kestrel, Piccola, Ruska 21, Saetta, Bison, Boxer 80,
  Corsaire, Falco, Kurenai, Strada Evo, ...). There are 12 named AI rivals,
  liveries, a garage, a driver profile/level, credits, redeem codes, a golden
  duck collectible, a 1986 retro mode, photo mode, ghosts and championships.
- Co-driver: the pace notes are **pre-recorded clips** cut out of one MP3 per
  language (`data/voice-en.mp3`, `voice-de.mp3`) using offsets from
  `voice-*.json`.
- Online: lobbies over **MQTT-over-WebSocket on public brokers**
  (`wss://broker.emqx.io:8084/mqtt`, fallback `broker.hivemq.com`), topic
  prefix `apexdrift/v1/`. The broker list can be overridden with a `?brokers=`
  query parameter.
- Stage target times live in `data/authors.json` (`"100": {seconds: 558.62}`
  and so on). These are probably what medals and rival pace are measured
  against.
- Ships an in-app `privacy.html` (dated 29 Oct 2026). It says: no ads, no
  analytics, no account, everything stays local except online lobbies.

## Player feedback on 2.0.0 (the owner's words, all must be resolved)

1. "Really, really laggy." The game and the cars stutter.
2. "The voice pisses me off."
3. "It just bugs all the time."
4. "The car models are not the best."
5. "It's a bit too hard right now."
6. "It first needs a tutorial."
7. "There are still things on the road that should not be there."
8. "The maps, textures etc. could be better, and it should have that
   cinematic, cozy feel."

## Work, in this order

### 1. Performance: 60 fps on a mid-range phone, no hitches

Before changing anything, measure. Add a release-safe frame-time recorder
(p50/p95/p99 frame ms, longest frame, draw calls, triangles, JS heap) to the
existing `#fpsbox`, and record a baseline on one stage per biome at every
quality level. Use Chromium with 4× CPU throttling at 1280×720 as a stand-in.
If a real device is available, use Chrome remote debugging on the WebView.

Likely causes to check (*hypotheses*):
- **Physics spiral.** 120 Hz × up to 8 substeps means a slow frame triggers
  up to 8 physics ticks, which makes the next frame slower. Run physics at
  60 Hz with interpolation (the accumulator already returns an alpha; make
  sure rendering actually uses it), cap substeps at 3–4, and drop
  accumulated time instead of catching up.
- **Car stutter.** The car mesh is positioned from the raw physics state
  instead of interpolated between the previous and current tick. That jitters
  even at a high fps. The chase camera should follow the interpolated pose,
  smoothed with a critically damped spring and not a frame-rate-dependent
  lerp.
- **Shadows.** PCFSoft with a large map on mobile. Use one shadow-casting
  directional light with a tight frustum that follows the car, `PCFShadowMap`,
  a 1024 map on medium and none on low. Static scenery shouldn't cast shadows
  outside the camera's near range. Ground contact can come from a baked or
  blob shadow.
- **Device pixel ratio.** Cap it at 1.0–1.25 on phones, or use dynamic
  resolution that drops render scale when p95 frame time goes above 18 ms.
- **Scatter and terrain.** Check draw calls. Merge static scenery per chunk,
  use `InstancedMesh` for every repeated prop, use LOD/impostors for trees
  past ~80 m, and stream chunks along the route. Never build geometry on the
  main thread mid-stage.
- **GC hitches.** Find per-frame allocations (`new Vector3`, array spreads,
  closures, template strings in the HUD loop). Only touch the DOM when a
  displayed value changes.
- **Shader compile hitches.** Call `renderer.compile()` (or warm up every
  material) during the loading screen, so nothing compiles on the first
  corner.
- **"auto" quality.** Pick the starting tier from a 2-second benchmark during
  loading, then adapt at runtime. Persist the result.
- **WebView.** Make sure hardware acceleration is on (it is in the manifest),
  that `onRenderProcessGone` is handled (today a GPU crash kills the app with
  no message), and that the game pauses and the rAF loop stops in
  `onPause`.

Done when: p95 frame time is ≤ 16.7 ms and there are no frames over 50 ms
after the countdown, on medium quality, on every biome at 4× throttle.
Commit the before/after numbers in a `PERF.md`.

### 2. Bugs: zero errors, nothing breaks a run

- Run a scripted Playwright soak: start every stage of every rally, drive it
  with a simple autopilot (route-following steering), finish it, open
  results, and go back to the menu. Do this in both languages and with touch
  and keyboard. Fail on any `console.error`, `pageerror`, unhandled
  rejection, NaN in car state, a car below the terrain, or a stuck
  countdown.
- Find out what "bugs all the time" means by recording a session. Usual
  suspects: getting stuck on invisible barriers, RESET dropping you in the
  wrong place or facing backwards, the camera clipping into terrain, the
  pause/resume state machine, a double-tap on a menu button starting two
  stages, touch controls getting stuck when a finger slides off a button
  (handle `pointercancel`/`lostpointercapture`), and the Android back button
  closing the app mid-stage instead of pausing.
- Every bug found gets a regression test.

### 3. Things on the road

The scenery placer rejects a point if `route.closest(x,z).dist < half + 0.45`.
Possible causes (*hypotheses*):
- Trees, rocks, houses, spectators, signs and lake shores each use their own
  placement path with its own margin, and not every path calls the same
  check.
- `closest()` searches a spatial grid with a hint index. Where the route
  doubles back (hairpins, the Poly Knot crossings, bridges) it can return the
  wrong leg and a larger distance.
- Props are placed at the centre point only, so a wide object (house, tree
  canopy, crowd) with its centre just off the verge still overhangs the road.
- Water splashes or ruts generated on the road surface.

Fix: one shared `isClearOfRoad(x, z, radius)` that checks the true global
nearest segment plus the object's footprint radius plus a margin (≥ 1.5 m
for solid objects), used by every placer. Add a test that walks all 48
stages plus the Poly tracks and asserts that no solid instance's footprint
intersects the drivable width. Make that test part of CI.

### 4. The co-driver voice

The JSON shows the clip cuts are wrong. `and` is 3.42 s long, `start` 3.46 s
and `sand` 2.67 s, while normal words are 0.4–0.7 s. They are almost
certainly carrying silence or neighbouring words. On top of that, a full
call is several separate clips glued together.

- Re-cut every clip tightly, normalise loudness (about −16 LUFS), add a 5 ms
  fade at both ends, and verify by script that no clip is longer than
  1.2 s except the deliberate phrases.
- Put the co-driver on its own volume slider, plus three options: **Full
  notes**, **Corners only**, **Off**. Off must be one tap away in pause.
- Call timing should be based on distance at current speed, not fixed. Don't
  call the same note twice, don't stack calls on top of each other, and duck
  the engine under the voice instead of shouting over it.
- If the current recordings still sound robotic after re-cutting, replace
  them with a better recording. The source and licence of whatever voice is
  used must be written down (see Release).

### 5. Difficulty: winnable on the first try

- Add a **difficulty setting**: Rookie / Driver / Pro. Rookie is the default
  for new players. It scales rival pace (target times from
  `authors.json`) by about 1.25 / 1.10 / 1.00, and on Rookie it turns on
  steering assist, traction/stability assist, automatic braking for
  hairpins, and softer off-road penalties.
- Medal thresholds come from the same scale. The first stage of the first
  rally must be beatable for gold by a new player on Rookie. Verify this with
  the autopilot driving at a deliberately mediocre line.
- Barriers should redirect, not stop the car dead. Off-track resets should
  happen automatically after ~3 s stuck, with a small time penalty.
- Touch controls: auto-gas is already on by default. Add steering smoothing,
  and on Rookie pull the car toward the road centre when no input is given.
- Reorder the career so the first rally is the easiest surface (wide gravel,
  e.g. Finland or Kenya), not Monte Carlo ice and snow.

### 6. Tutorial: first-run onboarding

On the first launch, go straight from the title screen into a short
**driving school** stage of about 60 s on a wide, forgiving road. Contextual
prompts appear exactly when needed: steer, gas/brake, handbrake into the
hairpin, what a pace note means (the voice says "left three" while an arrow
shows it), RESET, and pause. Each prompt waits until the player does the
action once. It can be skipped, replayed from Options, and works for both
touch and keyboard. It ends by offering the first rally on Rookie. Track
completion in local save data only.

### 7. Car models

- Remodel the starter cars (Kestrel, Piccola) and every car shown in the
  garage. They should have proper proportions, a chamfered body instead of
  boxes, separate wheels with tyres and rims, wheel arches, glass, lights
  that read at night, mudflaps and a roof vent. They must stay original
  designs: no real manufacturer's shape, badge or name.
- Budget per car: ≤ 8k triangles at LOD0, ≤ 2k at LOD1, one material plus a
  small atlas, livery through a mask. Rival cars and ghosts use LOD1.
- Wheels steer and spin, the body rolls and pitches with suspension, and dust
  or snow spray comes from the wheels, not the car centre.
- Interpolated render pose (see Performance). This is half of "the cars lag".

### 8. Look and feel: cinematic and cozy

What 2.0 does now: ACES tone mapping, terrain coloured per vertex with no
real surface textures, Lambert/Phong/Standard materials mixed, hemisphere
lighting, and weather and time-of-day variants already in the data. The
letterbox bars (`#bars`) exist but are hardly used. It reads as clean but
flat and synthetic.

Target mood: **a warm Sunday-morning rally film**. Golden low sun, long soft
shadows, dust hanging in the light, a crowd cheering from a hillside, then
back to a quiet service park with a cup of coffee. Cinematic when you drive,
cozy between stages. Every item below has to fit inside the performance
budget from section 1. If something costs frames, it scales down with the
quality tier or goes.

**Lighting and grading**
- One art-directed lighting preset per rally and time of day: sun angle,
  colour temperature, sky, fog colour and density, exposure. Favour golden
  hour, soft overcast and blue hour over flat midday. Store them as data so
  they're easy to tune.
- A colour-grading LUT per biome (warm, slightly lifted shadows, gently
  desaturated greens) applied in one cheap final pass, together with a soft
  vignette, very subtle film grain and a light bloom on the sun, headlights
  and wet surfaces. On low quality, use only the grade, with no bloom.
- Height and distance fog with aerial perspective, so the hills fade into the
  sky colour. That's the cheapest way to get depth, and it hides the draw
  distance.
- Baked ambient occlusion in vertex colours for scenery, plus a contact
  shadow under the car. Use a consistent material model (Standard everywhere,
  or a single custom lit shader). Don't mix three.
- Light shafts or sun glare as a cheap screen-space sprite. No volumetrics.

**Maps and textures**
- Replace the flat vertex colours with tiling detail textures: gravel, snow,
  ice, mud, sand, tarmac, grass, rock, forest floor. Use a texture array or
  atlas, blended by the existing surface and biome data, with a macro
  variation map so tiling doesn't show, and triplanar mapping on cliffs and
  rock cuts. Sources: CC0 only (ambientCG, Poly Haven), recorded in
  `CREDITS.md`. Ship them as KTX2/Basis with mipmaps and keep texture
  memory ≤ 128 MB on medium.
- A road that tells a story: a worn racing line, ruts and loose gravel at
  the edges, tyre marks into hairpins, puddles after rain, snow banks on the
  Swedish stages, red dust trails in Kenya. Use decals or a road mask, not
  extra geometry.
- Skies: a painted gradient or HDR-style sky per preset with clouds, plus
  layered distant silhouettes (mountains, coastlines, forest ridges) so the
  horizon never looks empty.
- One recognisable **landmark per country**, original and not a real
  copyrighted building: a lighthouse and terraced vineyards in Portugal, a
  shrine gate and cedar forest in Japan, a stone harbour town on the
  Mediterranean coast, wooden lakeside saunas in Finland, a baobab and a
  zebra herd in Kenya. That's what players screenshot.
- Track design pass: every stage gets a rhythm (flowing section, technical
  section, a big moment like a jump, splash or crest with a view), readable
  corners with signage and chevrons before the tight ones, and no blind
  corner without a pace note. Remove dead-straight filler.
- Life: crowds that wave and step back as you pass, marshals, a helicopter
  over the big jump, birds taking off, flags, smoke from chimneys. All of it
  is instanced and cheap, and none of it ever stands on the road (section 3).

**Camera and presentation**
- Pre-stage: a 6–8 s flyover of the stage start with letterbox bars, the
  stage name in large type, and the co-driver's "Ready... go" (skippable with
  a tap).
- While driving: a chase camera with slight lag, FOV that opens with speed,
  gentle shake only on rough surfaces and landings (the "reduce camera shake"
  option turns it off), and a short slow-motion shot over the big jump only
  when the player chooses it in Options.
- Finish: a replay of the stage's best moment from a trackside camera, then
  the results card. Make the photo mode presets (golden hour, film, vintage
  1986) match the grading.
- Cinematic camera angles for the menus and garage. The car rotates slowly
  on a turntable under warm lamps.

**Cozy layer**
- Service park and garage: a warm, lamp-lit tent, tools on the wall, a
  mechanic, rain tapping on the roof when the next stage is wet. This is
  where the player rests between stages, so it has to feel calm.
- Music: an original soft acoustic/lo-fi menu theme and a quieter driving
  bed that ducks under the co-driver, with separate music, effects, engine and
  voice sliders. Use only music you own or have licensed, and record it in
  `CREDITS.md`.
- Ambience per biome: birds and wind in the forest, waves on the coast,
  cicadas in the Mediterranean, crowd cheers at spectator spots.
- Rally "postcards": completing a rally unlocks a hand-drawn-style card of
  that country, shown in a scrapbook. That's progression that feels personal
  instead of grindy.
- Tone: encouraging copy ("Nice line through the hairpins"), no harsh red
  failure screens, soft UI transitions (transform/opacity only, collapsed by
  `prefers-reduced-motion`).

Done when: side-by-side screenshots of the same five spots (one per biome)
in 2.0 and 3.0 are committed to `store/compare/`, and 3.0 still meets the
section 1 frame-time target on medium.

### 9. Release blockers found in the 2.0.0 APK

- **The admin backdoor ships in the bundle.** The redeem table contains the
  literal string `TOMIC-ADMIN-7731` (hashed at runtime, but the plaintext is
  in `app.js`), and that unlocks the admin panel (F9) for anyone who unzips
  the APK. Strip the admin panel and the dev codes from release builds at
  build time (`import.meta.env.DEV`). They must not merely be hidden.
  Review the remaining public codes (TOMIC, APEX2026, ...) the same way.
- **The `?brokers=` override** lets any URL redirect online traffic. Remove
  it from release builds.
- **Public MQTT brokers** have no authentication. Anyone can read lobby
  traffic, inject fake players and positions, or flood a lobby, and the
  brokers have no SLA. For launch, either:
  (a) run your own relay with per-lobby validation and rate limits, for
  example a Cloudflare Worker with Durable Objects plus WebSockets on the
  free tier, or
  (b) ship 3.0 without Online. Remove the tab entirely (no "coming soon"
  placeholder) and add it back in 3.1.
  If online ships, add a driver-name profanity filter, the ability to
  hide/mute and block a player, and kick for the host. Play treats
  player-chosen names that other players can see as user-generated content.
  Validate every incoming message: types, ranges, rate, and positions that
  are physically possible.
- **`WRITE_EXTERNAL_STORAGE` (maxSdk 28)** is declared. If it's only for
  saving photo-mode shots, use `MediaStore` (no permission needed on API
  29+) and drop the permission. Otherwise justify it.
- **`allowBackup=true`**: decide on purpose. Either keep it and add
  `dataExtractionRules`/`fullBackupContent` that include the save, which is
  good for players who change phones, or turn it off.
- **The JavaScript bridge** must only respond to the asset-loader origin.
  Turn off `setAllowFileAccess`/`setAllowContentAccess`, and keep WebView
  debugging off in release.
- **Trademarks.** "Apex WRC" livery: *WRC* is a registered trademark of the
  FIA/WRC Promoter. Rename it. "Monte Carlo" (Rallye Monte-Carlo),
  "Safari Kenya" and "Acropolis" are the names of real events. Use plain
  place names (e.g. "Alpes-Maritimes", "Rift Valley", "Greece") so the
  listing can't be taken down. Also check that no car, livery or rival name
  matches a real person or brand.
- **Asset licences.** List the source and licence of every texture, image
  (title.jpg, c-*.jpg, poly-*.jpg), sound and voice clip in `CREDITS.md`
  and in an in-game Credits screen. Fonts are OFL (Inter, Barlow Condensed);
  keep the licence files. Three.js is MIT.

### 10. Android build and Play Console: everything needed to publish

Build:
- versionCode **5**, versionName **3.0.0**.
- Release build as an **Android App Bundle (`.aab`)**, signed with an upload
  key in a keystore kept outside the repository (document where it lives and
  back it up). Enrol in **Play App Signing**. If 2.0.0 was signed with a debug
  key, it can't be updated in place. That's fine because this is the first
  Play release.
- targetSdk 36 (already meets Play's requirement), minSdk 26.
- R8/minify and resource shrinking on. Remove unused fonts and resources.
  Compress images (WebP/AVIF at the size they're actually displayed). Target
  a download of < 40 MB (the new textures cost more than 2.0's
  5.7 MB; keep the base download under Play's 200 MB limit without asset packs).
- Adaptive icon (foreground plus background layers, plus a monochrome layer
  for themed icons). 2.0 only has a single vector.
- Splash: Android 12+ `SplashScreen` API with the brand colour `#0b0d10`, so
  there's no white flash before the WebView paints.
- Handle the Android back button (pause → menu → confirm exit), predictive
  back, edge-to-edge/display cutouts (`viewport-fit=cover` is already set;
  respect `env(safe-area-inset-*)` on the HUD), and audio focus (pause when
  a call comes in or another app plays audio). Honour the device's
  mute/vibration settings.
- Offline: everything except Online must work in flight mode. Show an honest
  message on the Online tab when offline.
- Save data: version the save format and migrate 2.0 saves. A corrupt save
  must never crash the game; back it up and start fresh with a message.

Store listing assets (generate them, and commit them to `store/`):
- App icon 512×512 PNG (32-bit, ≤ 1 MB).
- Feature graphic 1024×500 JPG/PNG, no alpha.
- At least 4 landscape phone screenshots (16:9, e.g. 1920×1080) taken from
  real gameplay: driving on snow, gravel and tarmac, the garage, and results.
  Add 7" and 10" tablet screenshots too, since the game supports tablets.
- Optional promo video (YouTube URL).
- Short description (≤ 80 chars) and full description (≤ 4000 chars), in EN
  and DE (the game has both voices). No keyword stuffing, no "best/#1", and
  no real event, team or brand names.
- Category: Games → Racing. Contact email and a website or support URL.

Policy and forms in Play Console:
- **Privacy policy at a public HTTPS URL** (not only `privacy.html` inside
  the app). Host it on GitHub Pages or similar and link it in the listing and
  in-game. Update it to match exactly what 3.0 does, especially if online
  changes.
- **Data safety form**: no data collected if online is cut. If online ships,
  declare: name (driver name), in-app actions (gameplay, race positions),
  shared with other users, sent over encrypted transit (wss), not used for
  ads or analytics, and how deletion works.
- **Content rating (IARC questionnaire)**: no violence, no gambling, and
  whether there's user interaction/communication (yes if online with names).
- **Target audience**: pick 13+ or 18+. Choosing under-13 brings Families
  policy requirements, which online with public names would fail.
- **Ads**: declare "No ads". **In-app purchases**: none, and the credits are
  earned only.
- **App access**: everything is reachable without login. Say so.
- **Government/financial/health declarations**: none. **News app**: no.
- **Account deletion**: not applicable because there are no accounts. Say so
  in the policy.
- **New personal developer accounts must run a closed test with at least 12
  testers opted in for 14 continuous days** before they can apply for
  production access. Plan for it: an internal test track first (instant),
  then a closed test with ≥ 12 testers, fix what they report, then apply for
  production. Collect testers' Google account emails in advance. (Check the
  current Play Console rule when submitting. It has changed before.)
- Pre-launch report: upload to internal testing first and fix every crash or
  accessibility warning the Firebase Test Lab robot finds.
- Android vitals targets: user-perceived crash rate < 1.09 % and ANR rate
  < 0.47 %. Add a lightweight local crash log the player can export from
  Options. No third-party SDK, which keeps the "no analytics" promise true.

Developer account and legal (do these early, some take days):
- **Developer identity verification** in Play Console (government ID; for an
  organisation account a D-U-N-S number, which can take weeks). "Tomić
  Studios" as the developer name needs an organisation account if it should
  be a company and not your personal name.
- **EU trader status (Digital Services Act)**: you must declare whether you
  are a trader. Free, no ads and no in-app purchases usually means
  non-trader, but if you declare trader status your address and phone
  number are shown publicly on the store page.
- **Name check**: search the Play Store, App Store and trademark registers
  (EUIPO, WIPO, Swiss IGE) for "Apex Drift" before launch. If another game
  already uses the name, rename now, not after the listing has reviews.
- Reserve the support email and a simple website (the privacy policy can
  live there) under the studio name.

Launch readiness:
- A device test matrix: one low-end (≈ 3 GB RAM, Mali/Adreno 6xx), one
  mid-range, one high-end, one tablet, one foldable if possible. Run the
  tutorial, one full rally, a pause and resume after 10 minutes in the
  background, a rotation lock, a phone call during a stage, and flight mode.
- Thermal and battery: a 20-minute session must not throttle into
  stuttering. Add an optional 30 fps battery-saver mode.
- Release notes ("What's new") for 3.0.0 in EN and DE.
- A plan for the first update: how to collect feedback (support email,
  Play reviews; reply to every review in the first weeks) and a 3.0.1 slot
  for crash fixes from Android vitals.
- Staged rollout in production: 20 % → 50 % → 100 % over a few days, and
  halt it if crash rate or ANRs spike.

Accessibility and quality polish:
- Colour-blind-safe HUD and pace-note arrows (never colour only), text size
  option, remappable keyboard controls, subtitles for co-driver calls, and a
  "reduce camera shake" option.
- Every screen state designed: loading, offline, error, empty (no times yet),
  WebGL unavailable (show a clear message instead of a black screen), and
  low-memory.
- Localise every UI string in EN and DE, not only the voice.

### 11. Definition of done

- Every item under "Player feedback" is fixed and verified in the running
  build, not only in tests.
- The look-and-feel comparison screenshots exist and the game reads as warm
  and cinematic at every quality tier.
- `npm run verify` (or the repo's equivalent) passes: typecheck, unit tests,
  the stage-clearance test, and the 48-stage soak with zero console errors.
- `PERF.md` shows before/after numbers that meet the targets.
- A signed `.aab` for 3.0.0 builds reproducibly from a clean checkout with
  one documented command.
- `store/` contains every listing asset and both descriptions. `RELEASE.md`
  is a checklist covering each Play Console form above with the exact answers
  to give.
- There are no admin, debug or override paths in the release bundle. Prove it
  with a grep of the built `app.js` in CI.

Work in small commits with clear messages. After each section, drive the
built app in Chromium at phone landscape size, take screenshots, and look at
them before moving on.
