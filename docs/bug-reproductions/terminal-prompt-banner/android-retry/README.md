# Android validation retry

Applied flake.nix exactly from the main worktree's uncommitted Android configuration (the main branch commit itself is identical to the feature base). Adds Android API 36/google_apis image, emulator, build tools 36.0.0, NDK 27.1.12297006, CMake 3.30.5, JDK17, and SDK environment exports. `cmp` confirmed exact parity with main worktree. `nix develop`: adb 37.0.0; KVM usable.

Created test-owned AVD orca_prompt_banner_api36 under `.cache/prompt-banner-android/avd`, booted headlessly with no audio/snapshot on emulator-5582. Existing API34 AVD and user Orca profile were untouched. Isolated dev profile `/tmp/orca-prompt-check`, CDP 9237, Metro 8097. Cleared inherited ELECTRON_FORCE_IS_PACKAGED and runtime-source environment for dev startup. Long workspace profile path exceeded Unix socket limit, so used the short temporary path.

Orca version-matched Android skill used through orca-ide-cli. Runtime discovered emulator-5582, attached it, installed main worktree's existing native development shell APK, launched com.stably.orca.mobile, and loaded this worktree's Metro bundle. Paired using a local-only offer to the isolated runtime. Mobile web page loaded build a5cf4ed416629b65993fb2ccff26faf912ddb16d61723dd62f5923753dcc6509 from this worktree. Build and packaged bundle verification pass: 128 assets, 8,569,940 bytes.

Rendered Android assertions through forwarded WebView CDP:

- Injected controlled real xterm output (prompt followed by 80 response rows), then accepted prompt through this mounted page's history. This is a renderer test; not a real agent hook integration run.
- Banner height 44 CSS px, bottom 158; terminal host top 158: no overlap.
- Before tap viewportY=58, prompt marker row=3. Orca emulator tap at normalized (0.5, 0.2125) changed viewportY to 3; row text exactly `> Android prompt jump target`.
- Second prompt rendered with 60 response lines. Scrolling to row 10 selected `Android prompt jump target`; returning to bottom selected `Second Android prompt`, marker row 86.
- Screenshot android-tap.png captured actual emulator screen after tap. Software-rendered terminal glyphs look clipped in this emulator; DOM banner text and buffer contents are intact. This run establishes touch, geometry, selection, and jump behavior, not terminal font rendering quality.
- Focused tests: 11 pass. `git diff --check` passes. Prior laptop vm-test proof remains in ../smarter-target/desktop.png.

Cleanup: Orca emulator helper killed and emulator shut down through CLI; isolated app/Metro processes stopped. No changes to main worktree, user profile, or existing AVD. Removed the test-owned cache/AVD directory, including pairing secrets and captured terminal environment. They are excluded from evidence.
