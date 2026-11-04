# Apex Drift 3.0

A cozy, cinematic rally game for Android by Tomić Studios: 12 rallies, 48 stages, a co-driver, a driving school. Offline, no ads, no tracking.

3.0 is a rebuild. 2.0 existed only as a compiled APK (no source), so this version keeps 2.0's content (rallies, stages, cars, liveries, rivals, co-driver recordings) and replaces the engine, visuals, physics, menus and Android shell.

```
web/        the game: TypeScript + three.js, built with Vite into web/dist
  src/sim/      stage generator, car physics, stage rules (no rendering; unit-tested)
  src/render/   world streaming, scenery placement, cars, lighting, grading
  src/game/     saves, career, pace notes, co-driver, input, EN/DE strings
  src/audio/    synthesised engine, effects and music; co-driver playback
  src/ui/       HUD and DOM helpers;  src/app.ts  screens and the race loop
  e2e/soak.mjs  drives the built game in Chromium; fails on any error
  dev.html      dev-only views for checking the renderer and making store art
android/    WebView shell (Kotlin), Gradle build, signing from env vars
store/      icon, feature graphic, screenshots, listing texts
RELEASE.md  everything needed to publish, with the exact Play Console answers
PERF.md     what made 2.0 lag, what 3.0 does, and how to measure on a phone
CREDITS.md  every shipped asset and its licence
```

## Commands

```bash
cd web
npm ci
npm run dev           # http://localhost:5173  (dev views: /dev.html?mode=stage&r=0&s=1 or ?mode=car&car=saetta)
npm test              # unit tests: generation, physics, scenery clearance, pace notes, saves
npm run verify        # typecheck + tests + production build + release check
node e2e/soak.mjs     # end-to-end in Chromium (needs a build); --full loads all 48 stages

cd ../android
./gradlew assembleDebug        # needs the Android SDK; builds web/dist into the APK
```

## What the tests guarantee

- Every one of the 48 stages builds at its full length without the road overlapping itself, and the nearest-road lookup matches brute force.
- A careful driver (the test autopilot) finishes all 48 stages with no resets; a mediocre one wins gold on the first career stage on Rookie.
- **No solid object is ever placed where the car can reach**: trees (by crown size), rocks, houses, crowds, chevron boards, rails, walls and posts, checked against every leg of road on every stage, including hairpins.
- Every word the co-driver can say has a clip in both languages, and no single-word clip is over a second (2.0's "sand" was 2.7 s).
- Corrupt or tampered saves never crash the game; 2.0 saves carry name, credits, cars, liveries and settings forward.
- The release bundle contains no admin code, no network endpoints, no dev harness, and no absolute asset paths.

## Not verified yet

- **GPU frame times on real phones.** The container renders WebGL in software. Follow `PERF.md`.
- **The Android build.** The container can't download the Android SDK. The GitHub Actions workflow builds it; the first CI run is the first real compile of the Kotlin shell.
- On-device behaviour: audio focus, the back button, cut-outs, saves surviving the update from 2.0.
