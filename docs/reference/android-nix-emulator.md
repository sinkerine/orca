# Dedicated Android emulator with Nix

Enter the Android shell from the repository root:

```sh
nix develop .#android
```

The shell supplies Java 17, the Android 36 platform, Build Tools 35 and 36, NDK
27.1.12297006, CMake 3.22.1, adb, and the emulator with a Google APIs image for
the host architecture. SDK and image revisions come from `flake.lock`.
Google's Android SDK licenses are accepted by this shell's Nix configuration.
The default development shell does not download the Android toolchain.

On Linux, the current user needs access to `/dev/kvm` for acceleration. Check:

```sh
emulator -accel-check
```

Start a dedicated emulator in a separate terminal, leaving its process running:

```sh
ORCA_BACKGROUND_LAUNCH=1 orca-android-emulator -port 5580
```

The launcher creates `orca-feature-api36-<abi>` on first use and runs headlessly
with software graphics, no audio, and no snapshots. It keeps writable AVD state
under the ignored `.android-test/` directory in the current directory. Always
launch from the repository root, or set `ORCA_ANDROID_STATE_DIR` to an absolute
scratch directory. Use a free even emulator port and retain the resulting
`emulator-<port>` serial for every device operation.

Build the development APK using the existing Expo and Gradle entry points:

```sh
pnpm --dir mobile install --frozen-lockfile
pnpm --dir mobile exec expo prebuild --platform android --no-install
cd mobile/android
ORCA_BACKGROUND_LAUNCH=1 ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=4
```

Use `arm64-v8a` instead of `x86_64` on an ARM host. Generated native files and
APKs stay ignored. The shell overrides Gradle's downloaded aapt2 with the
Nix-provided binary, so builds work on NixOS.

Start Metro from the repository root in another Android shell:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm --dir mobile exec expo start --dev-client --host localhost --port 8089
adb -s emulator-5580 reverse tcp:8089 tcp:8089
```

Use the version-matched `orca-emulator-android` skill to install
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`, launch the dev client,
open its Metro URL, and drive the emulator. Scope each operation explicitly to
`emulator-5580` so another device is never selected accidentally. Capture evidence
without opening a desktop window:

```sh
adb -s emulator-5580 exec-out screencap -p > .android-test/screenshot.png
```

## Verify host-delivered screens

Android loads host-area screens from the paired host's mobile web bundle. Metro
alone does not replace those screens. Build the bundle from the changed source
and pair with a disposable host serving that checkout:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm run build:mobile-web
ORCA_BACKGROUND_LAUNCH=1 pnpm run build:electron-vite
```

Keep the host's profile and home isolated from daily Orca data. Advertise
`10.0.2.2` as the pairing address for the Android emulator. Confirm the build ID
in the app matches `out/mobile-web/manifest.json` before claiming to have tested
a source change. A host from another installation serves that installation's
bundle even when the native shell came from this checkout.

For agent variant verification, configure a variant on the disposable host for
an enabled, detected agent, then select it in New Tab. Use a harmless command
that writes an identifiable marker into `.android-test/`, and check both the
new session tab and the marker contents. This proves command execution without
starting a paid agent session. Check the accessibility tree for the variant's
label; software-rendered terminal glyphs can be distorted in emulator screenshots.

When finished, stop the emulator through the scoped Orca emulator shutdown
command and stop the Metro and disposable host processes you launched. Preserve
only the screenshots and result files needed for evidence; `.android-test/` is
local disposable state and must not be committed.
