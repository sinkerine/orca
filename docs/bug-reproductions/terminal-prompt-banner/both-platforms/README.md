# Current repair verified on laptop VM and Android

Validation-only run; no feature code edits. Current local repair over a0befb9d876f. ORCA_BACKGROUND_LAUNCH=1 for apps/tests.

Laptop: vm-test s1-31bbaff6, hidden Electron CDP. Prompt status and earlier transcript prompt seeded before output replay. Two prompts, 45 response rows each:

- viewport 10 => banner Earlier restored prompt.
- viewport 55 => banner Latest restored prompt.
- actual CDP click => viewport 47, row text `> Latest restored prompt`.
- Hide and reopen floating workspace => latest banner still present; scrolling back to 10 still selects Earlier restored prompt.
- Screenshots desktop-jump.png and desktop-earlier.png.

Android: native development shell APK, current worktree's Metro bundle and mobile web build 32876a25ca5df8390e8cbe8036fede98052c92ef62c12bb683f48c07e013aedb. Bundle verifier passes (128 assets, 8,572,082 bytes). Test-owned API36/google_apis emulator orca_prompt_both, emulator-5582, 480x960, software GPU. Paired local-only to isolated desktop profile /tmp/orca-prompt-both. Existing xterm DOM fallback selected only in test WebView for readable glyphs; production defaults unchanged.

- Seeded latest status and earlier prompt before replay, two prompts with 65 response rows each.
- viewport 10 => Android earlier restored prompt; viewport 80 => Android latest restored prompt.
- Banner height 44 CSS px. Real Orca emulator tap at (0.5, 0.1416667) => viewport 68, row exactly `> Android latest restored prompt`.
- android.png shows the readable prompt immediately beneath its banner.
- Android initial subscribe replaced its terminal once; reacquired active mounted instance and reran all recorded assertions.

Scope: controlled prompts supplied through mounted histories and real xterm output. These runs verify replay resolution, banner render/subscriptions, scroll selection, retained desktop view and physical Android tap. They do not exercise provider-generated transcript RPC/hook contents end to end. Transcript parser and loading logic also have focused tests/typechecks in ../scroll-fix.

Cleanup: emulator helper killed and emulator shut down; isolated runtime and Metro stopped; VM stopped and cleaned after screenshots copied; test AVD/cache and pairing secrets removed. User runtime and other emulator/Metro sessions untouched.
