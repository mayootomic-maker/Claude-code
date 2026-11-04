# Releasing Apex Drift 3.0.0 on Google Play

A checklist in the order it has to happen. Items marked **(you)** need a person with the Play Console account; everything else is done in this repository.

## 0. Before anything else (some of these take days or weeks)

- [ ] **(you)** Play Console developer account, identity verified. If the developer name should be "Tomić Studios" rather than your own name, that needs an *organisation* account, which needs a **D-U-N-S number** (free, but can take a few weeks).
- [ ] **(you)** **EU trader status (Digital Services Act).** Declare whether you're a trader. A free game with no ads and no purchases is usually non-trader. If you declare trader status, your address and phone number are shown publicly on the store page.
- [ ] **(you)** Name check: search the Play Store, App Store and trademark registers (EUIPO, WIPO, Swiss IGE) for "Apex Drift". Rename now if it's taken; renaming after reviews come in is much worse.
- [ ] **(you)** A support email address. Optionally a simple website; the privacy policy has to be at a public HTTPS URL (see step 3).
- [ ] **(you)** Confirm the co-driver voice licence (see `CREDITS.md`).

## 1. Build

```bash
cd apex-drift/web
npm ci
npm run verify          # typecheck, unit tests, production build, release check
node e2e/soak.mjs       # drives the built game in Chromium; fails on any error

cd ../android
# Upload key, created once and kept OFFLINE with a backup. Never commit it, never upload it to Drive:
#   keytool -genkeypair -v -keystore apexdrift-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
export APEX_KEYSTORE=/path/to/apexdrift-upload.jks APEX_KEYSTORE_PASSWORD=… APEX_KEY_ALIAS=upload APEX_KEY_PASSWORD=…
./gradlew bundleRelease assembleRelease
# → app/build/outputs/bundle/release/app-release.aab   (upload this to Play)
# → app/build/outputs/apk/release/app-release.apk      (for side-loading on test phones)
```

The GitHub Actions workflow `.github/workflows/apex-drift.yml` does the same on every push and uploads the APK and AAB as artifacts. Add the repository secrets `APEX_KEYSTORE_B64` (base64 of the .jks), `APEX_KEYSTORE_PASSWORD`, `APEX_KEY_ALIAS` and `APEX_KEY_PASSWORD` to get signed builds from CI.

- versionCode **5**, versionName **3.0.0**, targetSdk 36, minSdk 26
- Enrol in **Play App Signing** when you create the app. Play keeps the app signing key, and you keep the upload key.
- If 2.0 was ever uploaded to Play under `com.tomicstudios.apexdrift`, the upload key must be the one Play already knows, or you request an upload-key reset.

## 2. Test on real phones (`PERF.md` has the procedure)

- [ ] Low-end (about 3 GB RAM, Mali-G52 / Adreno 610 class), mid-range, high-end, a tablet, and a foldable if you can borrow one
- [ ] Driving school start to finish; one full rally; pause and resume after 10 minutes in the background; a phone call during a stage; flight mode; rotate lock
- [ ] A 20-minute session: no stutter from thermal throttling. If there is, "Battery saver" graphics must fix it
- [ ] Install 2.0 first, play, then install the 3.0 APK over it: name, credits and cars must carry over
- [ ] Turn on TalkBack on the menus: every button must be announced

## 3. Store listing (texts in `store/listing.md`)

- [ ] App name, short and full description, EN and DE
- [ ] App icon `store/icon-512.png`, feature graphic `store/feature-1024x500.jpg`, phone screenshots `store/screens/`
- [ ] Category Games → Racing; contact email
- [ ] **Privacy policy URL**: host `web/public/privacy.html` at a public HTTPS address (GitHub Pages works: put it in a public repo and enable Pages). Paste the URL here. The same page also ships inside the game, in Options → Data.

## 4. App content forms: exact answers

| Form | Answer |
|---|---|
| Privacy policy | The URL from step 3 |
| Ads | **No**, the app does not contain ads |
| App access | All functionality is available without special access (no login) |
| Content rating (IARC) | Category: Game. Violence: none. Fear: none. Sexuality: none. Language: none. Controlled substances: none. Gambling: none. **Users can interact or exchange content: No.** Shares location: No. Digital purchases: No. Expected result: PEGI 3 / USK 0 / Everyone |
| Target audience | **13 and over** (13–15, 16–17, 18+). Not "under 13": the Families policy adds requirements the game doesn't need |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | **No data collected. No data shared.** The app requests no internet permission. Data encrypted in transit: not applicable. Users can request deletion: not applicable (nothing collected); in-game "Erase all progress" deletes local data |
| Government app | No |
| Financial features | None |
| Health | None |
| Account deletion | Not applicable: the app has no accounts |

## 5. Closed test (required for new personal developer accounts)

Accounts created after November 2023 must run a **closed test with at least 12 testers opted in for 14 days in a row** before they can apply for production. Check the current rule in Play Console when you start; it has changed before.

- [ ] Internal testing track first (available instantly): upload the AAB and check the **pre-launch report**. Fix every crash and every accessibility warning it finds
- [ ] Closed testing track with ≥ 12 testers (collect their Google account emails beforehand; friends and family are fine). Keep them opted in for the full 14 days
- [ ] Fix what testers report; ship 3.0.x builds to the same track as needed
- [ ] Apply for production access

## 6. Production

- [ ] Release notes from `store/listing.md` ("What's new")
- [ ] **Staged rollout**: 20 % → 50 % over a few days → 100 %. Halt if the crash rate or ANRs jump
- [ ] Android vitals targets: user-perceived crash rate below 1.09 %, ANR rate below 0.47 %
- [ ] Reply to reviews during the first weeks; keep a 3.0.1 slot ready for crash fixes

## Hand-off folder (Google Drive)

Upload to a folder named `Apex Drift 3.0.0`: the signed `.aab`, the signed `.apk`, the whole `store/` folder, this file, `PERF.md`, `CREDITS.md` and `web/public/privacy.html`. **Never** upload the upload keystore or its passwords.
