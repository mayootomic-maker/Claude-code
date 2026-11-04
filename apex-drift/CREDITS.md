# Credits and licences

Every asset that ships in Apex Drift 3.0, where it came from, and under which terms.

| Asset | Source | Licence |
|---|---|---|
| Game code | Tomić Studios | All rights reserved |
| three.js r170 (3D engine, bundled) | https://threejs.org | MIT |
| Inter (UI font, `web/public/fonts/inter-*`) | Rasmus Andersson | SIL Open Font License 1.1 (`OFL-Inter.txt`) |
| Barlow Condensed (display font, `web/public/fonts/barlow-*`) | Jeremy Tribby | SIL Open Font License 1.1 (`OFL-BarlowCondensed.txt`) |
| Co-driver voice, English and German (`web/public/voice/`) | Recorded for Apex Drift 2.0; re-cut and loudness-normalised for 3.0 | Tomić Studios |
| Music | Generated in the game at runtime (`web/src/audio/audio.ts`, class `Music`) | Original, Tomić Studios |
| Engine, gravel, wind, rain, crowd, birdsong and UI sounds | Synthesised in the game at runtime (`web/src/audio/audio.ts`) | Original, Tomić Studios |
| Road, terrain and detail textures | Painted procedurally at load time (`web/src/render/textures.ts`) | Original, Tomić Studios |
| Cars, trees, houses, spectators, rails, signs | Built procedurally in code (`web/src/render/car-model.ts`, `props.ts`) | Original, Tomić Studios |
| Menu and store artwork (`web/public/img/`, `store/`) | Rendered from the game itself (`web/dev.html?mode=card`, `mode=car`) | Original, Tomić Studios |
| App icon | Tomić Studios chevron mark | Tomić Studios |

## Things to confirm before publishing

- **The voice recordings.** They were in the 2.0 APK. Confirm who recorded them (or which text-to-speech service produced them) and that its terms allow commercial distribution in a free app. If the voice came from a TTS service, check its licence for app redistribution specifically.
- **Car, livery, sponsor and rival names** are invented. 3.0 renamed the 2.0 "Apex WRC" car (WRC is a registered trademark) to "Apex R", and the rallies "Monte Carlo", "Safari Kenya" and "Acropolis" to "Riviera Alps", "Kenya" and "Greece". Stage names are real place names, which is normal for rally games, but do a final search that no sponsor name (Nordlicht, Meridian, Karst, Ferro Oil, Vela Tyres, Orbital, Alpenglas, Limen, IZUM) matches a real company in a confusing way.
