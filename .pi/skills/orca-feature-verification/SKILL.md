---
name: orca-feature-verification
description: Verify Orca features on both desktop in vm-test and Orca Mobile in a dedicated Android emulator. Use for cross-platform feature acceptance, regression checks, and validating fixes with rendered UI evidence from the current checkout.
---

# Verify features on desktop and Android

Use this workflow when a feature needs verification in both the desktop VM and Android app. Complete both paths by default. The task defines the feature and acceptance criteria; infer routine setup from the current checkout. If a platform has no corresponding feature, explain why that criterion is not applicable. An unavailable environment is blocked, never a pass.

## Load existing guides

Reuse these workflows rather than recreating their setup or command reference:

- Load the shared `vm-test` skill from the session's available skills, then read [Orca VM setup](../orca-vm-test/SKILL.md). Apply the shared skill's Electron invariants with Orca's stricter hidden-window policy below.
- Load `orca-emulator-android` from the session's available skills. Resolve the CLI once using that skill, then read its full version-matched guide with `ORCA skills get orca-emulator-android`. Here `ORCA` is a placeholder for that resolved executable, not a literal command. Do not guess emulator commands or flags.
- Read [dedicated Android emulator setup](../../../docs/reference/android-nix-emulator.md), [mobile development](../../../mobile/README.md), and the current root/mobile manifests and relevant launcher scripts.
- For Orca-managed workspace, terminal, or pairing operations, load the version-matched `orca-cli` guide as well. Keep CLI control attached to the intended disposable runtime, not the user's daily instance.

Resolve shared skills through the session catalog; do not copy machine-specific skill paths into this repository. If a required guide or tool is missing, report the exact blocker and continue independent checks that remain possible.

## Define the checks

Before launching, inspect the changed code and existing feature tests. Extend or run existing scenarios where they fit. Record the checkout path, commit, relevant uncommitted changes, and intended desktop/mobile build sources.

Build a short acceptance matrix with one row per observable behavior and separate desktop and Android results. Include:

- The main user action and its visible result.
- Relevant navigation away/back, persistence or reconnect behavior, and an error or empty state when the change affects them.
- Folder workspaces and git worktrees when workspace behavior changes; an SSH execution host when remote execution or status changes. Missing SSH coverage remains explicitly unverified.
- Mixed client/host versions when the change affects the paired protocol; new fields remain optional and new stream opcodes require capability negotiation.

Use disposable fixtures and harmless commands with unique output markers. Do not run paid agent sessions merely to prove launch behavior. Keep real profiles, repositories, credentials, and connected devices outside the fixtures.

## Desktop: vm-test

1. Start your own run from the active checkout, using the shared VM skill and the local Orca setup guide. Retain the returned run ID and use `vm-test --run ID` for every later operation. Never touch another run.
2. Set `ORCA_BACKGROUND_LAUNCH=1` for every app and test launch. Rebuild changed launch-policy code before launching. Use `--no-wait` and poll setup completion and CDP readiness; a visible window is not the readiness condition.
3. Keep Electron renderers hidden. Use Playwright attached through CDP for feature actions and assertions, and CDP screenshots for visual evidence. Inspect existing Playwright fixtures before writing a new driver. Do not use computer-use, reveal windows, activate the app, or fall back to native focus/input on the user's desktop. Record any native-focus or visible-window criterion as blocked unless a separately authorized isolated test can meet repository policy.
4. Verify a rendered page and, for terminal features, a real shell prompt in the expected fixture directory. Then exercise each acceptance criterion and assert the result after every action. Sending input successfully does not prove the feature worked.
5. Run relevant existing E2E checks with `electron-headless` and one worker. Build the required outputs from this source first; use `SKIP_BUILD=1` only after verifying those outputs are current. Keep Node/native checks and Playwright launches outside the VM's CDP Electron wrapper.
6. Inspect app and VM logs for exceptions, renderer exits, and measured resource exhaustion. Build and run the app sequentially when memory is tight. Follow the local VM guide for dependency repairs, writable storage, and evidence preservation.

A direct store/API mutation can help diagnosis, but does not verify the user interaction that normally produces it. Label programmatic checks separately from rendered UI assertions.

## Android: dedicated emulator

1. Use the repository's `nix develop .#android` environment where available and follow the dedicated emulator guide. Start a headless, run-owned emulator from the active checkout with a free even port and isolated writable state. Retain its serial and scope every device operation to that serial. Do not select a physical phone or reuse another agent's emulator.
2. Install mobile dependencies with the frozen lockfile and build a development APK from this checkout using the documented Expo/Gradle flow and the host architecture. Start Metro as a background process on an available port and configure the documented reverse mapping. Set `ORCA_BACKGROUND_LAUNCH=1` for app/test launches and retain process IDs and logs.
3. Install, launch, open the Metro URL, and drive the app using the resolved CLI's version-matched Android guide. Use fresh accessibility snapshots to find controls, then tap/type and assert the resulting state. Capture screenshots and scoped logcat evidence. Do not treat an RPC-only or browser-only check as an Android UI pass.
4. Pair with a disposable Orca host serving the source under test. Host-area screens come from the host's mobile web bundle: build the required desktop and mobile-web outputs, restart the affected host, and compare the app's build ID with `out/mobile-web/manifest.json`. Metro refresh alone does not update these screens. Rebuild/reinstall when native code changes.
5. Verify the actual network path before pairing. Android's `10.0.2.2` reaches the emulator's host; the VM's address of the same spelling reaches the VM's host. Neither automatically connects an Android emulator to a separate vm-test guest. Use a supported, explicitly verified forwarding path, or a separate isolated host built from the same checkout for Android. Record which host each platform tested. If no supported route works, report pairing as blocked rather than silently using a daily or stale host.
6. Repeat the applicable acceptance criteria on the real Android app. Include Back, keyboard interaction, navigation, and reconnect/relaunch where relevant. For commands, assert both the visible result and a unique execution marker on the execution host. For status, loss of contact means `unverifiable`, not `exited`.

Use debug/development builds for routine verification. Load [Android release signing](../orca-android-release/SKILL.md) only when the task specifically requires release-build behavior; do not access private signing material just to test a feature.

## Evidence, cleanup, and report

Keep a durable report and cited screenshots/log excerpts outside the VM slot and other directories that cleanup will remove. Redact tokens, pairing payloads, account identifiers, and secrets. Record:

| Criterion                               | Desktop VM                             | Android emulator                       | Evidence                                  |
| --------------------------------------- | -------------------------------------- | -------------------------------------- | ----------------------------------------- |
| Observable behavior and expected result | Pass / fail / blocked / not applicable | Pass / fail / blocked / not applicable | Screenshot, assertion output, or log path |

Include the source commit and relevant local changes, exact setup/build/test commands, extra dependencies, VM run ID, emulator serial/ABI, APK path, host identity, mobile-web build ID, and any failures or environment limits. A startup screenshot is startup evidence only; setup failure means the selected feature checks did not run. Mark pass only after observing and asserting that criterion on that platform.

Preserve evidence before cleanup, including on failure. Stop and clean your VM using its run ID. Shut down only your emulator through the scoped Orca command and stop only the Metro/disposable host processes you started. Leave no test windows visible, do not clear unrelated app data, and do not commit generated native files, APKs, AVD state, or credentials.

Return a concise platform-by-platform result with links to the report and key evidence. State incomplete coverage explicitly; do not describe a feature as verified on both platforms while either required path is blocked or failed.
