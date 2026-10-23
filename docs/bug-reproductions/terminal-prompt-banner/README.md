# Terminal prompt banner validation

VM run: `s1-b94a7d3e`, isolated NixOS desktop, Orca dev renderer via CDP on port 9222, `ORCA_BACKGROUND_LAUNCH=1` throughout. No host windows were activated.

Setup used `pnpm install --frozen-lockfile --store-dir /job/work/pnpm-store --package-import-method copy` in `/job/src`. Guest packages used for install/runtime/checks: pnpm, git, unzip, python3, gnumake, gcc. Native Electron installation required unzip. The VM source copy required its own disposable Git baseline because the build embeds a commit. Source/dependencies/cache remained on the disk-backed `/job` share. Measured guest memory: 7942 MB total, 6218 MB available after runtime setup; root used 591 MB.

Rendered checks used controlled accepted agent status updates and real xterm output, not a live provider CLI. Imported the same Vite module URL used by the component to avoid creating a second store after HMR. A cold page reload resolved stale module state caused by copying changes from the host (host copies do not notify guest watchers).

Observed:

- Prompt banner appears under floating-workspace terminal tabs, with terminal content below it. Banner bottom 221 px, terminal top 225 px in the initial check.
- Two turns with 80 output lines each: scrolling back to row 15 selected the first prompt; returning to bottom selected the second. See `scrollback.png` (initial appearance before the click interaction refinement).
- Clicking the final banner moved viewportY to 81, exactly matching its marker line of 81. See `click-jump.png` (final appearance).
- Full prompt inspection uses the existing tooltip; click and keyboard button activation jump without expanding terminal chrome.

Automated checks: eight focused tests pass; `pnpm tc:web` checks 15,341 files without errors; formatting passes. Two independent Claude review passes completed with no Critical or Important findings remaining. The first review's resize churn and trimmed-marker issues were fixed. Final logs are retained beside this report.

The existing localization catalog check reports two unrelated missing keys in unchanged files (`auto.components.sidebar.DeleteWorktreeDialog.migrateOriginalCheckout`, `components.terminalPane.copyFailed`); the banner's English key is present and runtime catalog verification passes. A later overlapping check run exhausted guest memory and killed Electron and tsgolint; the checks were repeated sequentially after stopping Electron. The screenshot predates the final accessibility/performance refinements and local callback rename; click behavior is additionally covered by the final component test.

Scope limits: this validates renderer status integration, terminal scrolling and layout; real provider hook/output timing, SSH transport, macOS/Windows, and alternate-screen agent scrollback were not exercised end to end. A prompt marker records the cursor position when an accepted new prompt reaches the renderer; independent hook and output delivery can shift it from the exact first painted prompt row. Historical anchors exist only for this mounted renderer. Trimmed/unanchored prompts retain text but cannot be jumped to.
