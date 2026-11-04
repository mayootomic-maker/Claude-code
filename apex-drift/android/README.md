# Apex Drift — Android shell

A single-activity WebView wrapper around `apex-drift/web`. The game is served
from `https://appassets.androidplatform.net/assets/www/index.html`, the same
origin as 2.0, so players' localStorage saves survive the update. Do not change
that URL or the `assets/www/` layout.

## Build locally

Needs JDK 17 (or any newer JDK; Gradle fetches 17 itself) and the Android SDK
with platform 36 (`ANDROID_HOME` set, or `sdk.dir` in `local.properties`).

```bash
cd apex-drift/web && npm ci && npm run build     # produces web/dist
cd ../android
./gradlew assembleDebug                          # app/build/outputs/apk/debug/
./gradlew assembleRelease bundleRelease          # apk/release/ and bundle/release/
```

Gradle copies `web/dist/` into the APK's `assets/www/` on every build and fails
with an explicit message if `web/dist/index.html` is missing. Built web assets
are never committed under `android/`.

## Signing

Release signing is read from the environment. If `APEX_KEYSTORE` is unset the
release build is produced unsigned (useful for inspection, not for upload).

| Variable                 | Meaning                         |
| ------------------------ | ------------------------------- |
| `APEX_KEYSTORE`          | Path to the upload keystore     |
| `APEX_KEYSTORE_PASSWORD` | Keystore password               |
| `APEX_KEY_ALIAS`         | Key alias inside the keystore   |
| `APEX_KEY_PASSWORD`      | Key password                    |

Create the upload key once:

```bash
keytool -genkeypair -v \
  -keystore ~/apex-drift-upload.jks \
  -alias apex-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

If 2.0 was published with Play App Signing, this key must be the **upload key
already registered** in Play Console for `com.tomicstudios.apexdrift`; a new key
is only accepted after an upload-key reset there.

For CI, store `base64 -w0 ~/apex-drift-upload.jks` as the repository secret
`APEX_KEYSTORE_B64`, plus `APEX_KEYSTORE_PASSWORD`, `APEX_KEY_ALIAS` and
`APEX_KEY_PASSWORD`.

**The keystore must never be committed, attached to an issue, pasted into chat,
or uploaded anywhere other than the encrypted GitHub secret.** Anyone holding it
and its passwords can publish updates as you. `*.jks` and `*.keystore` are
gitignored here as a backstop, not as permission to keep it in the tree. Keep an
offline backup: losing it means an upload-key reset through Play support.
