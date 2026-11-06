# Apex Drift 3.0

A cozy, cinematic rally game for Android, Windows, macOS and Linux by Tomić Studios: 12 rallies, 48 stages, a co-driver, a driving school. Offline, no ads, no tracking.

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
desktop/    Electron shell for Windows, macOS and Linux (same web build)
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

cd ../desktop                  # after `npm run build` in web/
npm ci
npm run copy-web               # web/dist -> desktop/www
npm start                      # run it in a window
node scripts/package.mjs win32 linux darwin   # portable app folders in desktop/out
xvfb-run node scripts/smoke.mjs               # plays the start with keyboard only
```

## Playing on a computer

**The simplest way: one HTML file.** `npm run single` packs the whole game — code,
images, fonts, co-driver recordings and the engine-sound worklet — into
`web/dist-single/apex-drift.html` (about 3.3 MB). Double-click it: it runs from disk
in any current browser, offline, with no server. Every push publishes it as
`apex-drift.html` on the release. Saves live in the browser's storage for that file,
so keep opening the same copy. `node e2e/soak.mjs --single` plays it end to end.

**The owner's copy.** `npm run single:owner` builds
`web/dist-single/apex-drift-owner.html`: everything unlocked from the first launch
(all rallies, cars and liveries, top level, a million credits) and a **Cheats** tab
in Options with a code box. It keeps its own save, separate from a normal copy, and
is never published: CI only builds the normal file, and the release check fails if
cheat code ever reaches it. The codes are listed in that tab (MONEYBAGS, LEVELUP,
TURBO for double power, QUACK, TRUSTNO1, TOMIC, 1986, DONUTS and IZUM for the
secret liveries, UNLOCKALL).

The same owner copy for Android: every push builds `apex-drift-owner.apk` as a
workflow artifact (kept 14 days, never on the release). It installs as **Apex Drift
Owner** (`com.tomicstudios.apexdrift.owner`), next to the normal app, with its own
save. Locally: `npm run build:owner` in `web/`, then `./gradlew assembleOwner` in
`android/`.

**Or as an app:**

Every push builds `apex-drift-windows.zip`, `apex-drift-mac.zip` and `apex-drift-linux.zip`
on the `apex-drift-latest` release. Nothing to install: unzip and run.

- Keyboard: W A S D or arrows, Space handbrake, Q rewind, R back on the road, C camera,
  F fullscreen (F11 too), Esc pause and back. Any Xbox-style gamepad works as well.
- Esc in a race opens the pause menu, which has the sound, display and controls options,
  and photo mode (drag to orbit, scroll to zoom, Space or the button saves a PNG).
- After a stage, **Watch replay** plays the run back from TV cameras: long-lens trackside
  shots the car drives past, a helicopter, a wheel-arch camera and a low front shot.
- The game is served inside the app over a private `app://` scheme: module scripts and
  the engine-sound AudioWorklet will not load from `file://`.
- The builds are **not code-signed**. Windows SmartScreen asks "Run anyway"; macOS needs
  right-click → Open the first time (the app is signed ad hoc, not notarised). Signing
  needs a paid Windows certificate and an Apple Developer account.
- A per-tier cap on rendered pixels keeps 4K monitors from costing several times a
  phone's fill rate.

## What the tests guarantee

- Every one of the 48 stages builds at its full length without the road overlapping itself, and the nearest-road lookup matches brute force.
- A careful driver (the test autopilot) finishes all 48 stages with no resets; a mediocre one wins gold on the first career stage on Rookie.
- **No solid object is ever placed where the car can reach**: trees (by crown size), rocks, houses, crowds, chevron boards, rails, walls and posts, checked against every leg of road on every stage, including hairpins.
- Every word the co-driver can say has a clip in both languages, and no single-word clip is over a second (2.0's "sand" was 2.7 s).
- Corrupt or tampered saves never crash the game; 2.0 saves carry name, credits, cars, liveries and settings forward.
- The release bundle contains no admin code, no network endpoints, no dev harness, and no absolute asset paths.

## Not verified yet

- **Desktop builds on real Windows and macOS machines.** CI packages all three and plays the packaged Linux build under a virtual display; Windows and macOS are built but not launched.
- **GPU frame times on real phones.** The container renders WebGL in software. Follow `PERF.md`.
- **Signed release builds.** CI builds the debug APK, release APK and AAB on every push (artifact `apex-drift-3.0.0`), but the release files stay unsigned until the four `APEX_*` signing secrets are added to the repository.
- On-device behaviour: audio focus, the back button, cut-outs, saves surviving the update from 2.0.
