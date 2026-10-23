---
name: orca-android-release
description: Build and verify a locally signed Orca Mobile Android release APK using the existing private release key. Includes this machine's signing-key location and Gradle signing override.
---

# Orca Android release APK

Use the repository's current mobile sources, including any intended uncommitted changes. Run commands from the active Orca checkout. This builds a local artifact; publishing requires a separate user request.

## Signing identity on this machine

- Private directory: `/home/sinkerine/.local/share/orca/android-signing/release-20261022/`
- Keystore: `orca-release.p12` (PKCS12, RSA 4096, generated 2026-10-22, validity 10,000 days).
- Alias: `orca-release`.
- Passwords and alias: `signing.properties` in that directory.
- Public certificate: `orca-release-certificate.pem` in that directory.

Keep the directory mode 700 and private files mode 600. Never print passwords, commit credentials, or copy the private keystore into the repository. Back up the entire directory securely: future APK updates require this signing identity. Do not regenerate or overwrite it unless explicitly requested. An installation signed by another key must be uninstalled before installing this APK; uninstalling removes its local app data.

## Build

Use the existing Android release preparation and Expo prebuild flow. The signing init script next to this skill overrides Expo's default debug signing for the release build without modifying generated Gradle sources or committed app configuration. `ORCA_ANDROID_BUILD_TOOLS` also aligns native library modules with the installed SDK build tools; some otherwise request Build Tools 35, which the read-only Nix SDK cannot auto-install. `ORCA_ANDROID_CMAKE_VERSION` similarly aligns native modules that request CMake 3.22.1 with the installed CMake 3.30.5.

Prerequisites: mobile dependencies installed, JDK 17, Android API 36, Build Tools 36.0.0, NDK 27.1.12297006, CMake. The repository's Nix/direnv environment provides these. Read `mobile/README.md` for current prerequisites. If dependencies are missing, run `pnpm install --frozen-lockfile` in `mobile/`.

From the repository root:

```bash
export ORCA_BACKGROUND_LAUNCH=1
export NODE_ENV=production
export ORCA_ANDROID_BUILD_TOOLS=36.0.0
export ORCA_ANDROID_CMAKE_VERSION=3.30.5
export CMAKE_VERSION=3.30.5
export ORCA_ANDROID_SIGNING_DIR=/home/sinkerine/.local/share/orca/android-signing/release-20261022
repo_root="$PWD"
cd mobile
node scripts/prepare-android-release.mjs
pnpm exec expo prebuild --platform android --no-install
cd android
./gradlew --no-daemon --max-workers=2 -Dorg.gradle.parallel=false \
  -I "$repo_root/.pi/skills/orca-android-release/signing.init.gradle" assembleRelease
cd "$repo_root"
```

The init script limits Metro to two workers to avoid memory pressure on machines with many CPU cores (an unrestricted bundle was killed with exit 137 on this machine). Run lengthy builds in the background with a log, and inspect it periodically. Do not launch or focus the app to build it. Gradle builds all four default ABIs; preserve these unless the user requests a specific architecture. Do not bump the app version or version code automatically.

## Verify and deliver

```bash
apk=mobile/android/app/build/outputs/apk/release/app-release.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$apk"
"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 "$apk"
"$ANDROID_HOME/build-tools/36.0.0/aapt" dump badging "$apk"
```

Compare the APK's signer SHA-256 certificate digest with the SHA-256 fingerprint of `orca-release-certificate.pem` (`openssl x509 -in <certificate> -noout -fingerprint -sha256`). Confirm the expected package `com.stably.orca.mobile`, version from `mobile/app.json`, and non-debuggable status. Fail if the certificate differs or the APK is debuggable.

Copy the verified artifact to ignored `release/android/`, named `orca-mobile-<version>-release.apk`, and write a sibling `.sha256` file in `sha256sum -c` format. Record version, version code, certificate fingerprint, artifact checksum, and build architecture set in a sibling build report. Report clickable artifact and skill paths and the signing directory to the user. Do not include private passwords.
