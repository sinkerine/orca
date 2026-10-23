# Readable Android validation

Found a working verification method: use xterm's existing DOM renderer in the test WebView. No product code, fonts, spacing or terminal buffer changed.

Comparison on the same headless Android API36/google_apis emulator:

- 720x1280 display, emulator `-gpu software` instead of the previous deprecated `swiftshader_indirect` mode: glyph clipping persisted (webgl-clipped.png).
- Dispose only the mounted xterm WebGL addon through WebView CDP, then `terminal.refresh(0, terminal.rows - 1)`: text is readable (dom-jump.png). This isolates the problem to the WebGL rendering path in this emulator; it does not establish the underlying GPU/atlas defect.
- Confirmed zero canvases and 70 `.xterm-rows > div` rows after switching. Existing mobile `webgl-recovery.ts` already falls back to this renderer when WebGL is unavailable.

Test-only CDP switch, after obtaining the actual mounted terminal:

```js
const addon = terminal._addonManager._addons.find((a) => a.instance.onChangeTextureAtlas)
addon?.instance.dispose()
terminal.refresh(0, terminal.rows - 1)
```

Private xterm inspection is used only in this diagnostic session, not product code. Reacquire the mounted terminal after snapshot replay/re-init; an old object may already be disposed. Production renderer defaults remain unchanged.

Validation in the native Android app, serving the same verified mobile bundle (a5cf4ed41662):

- Controlled prompt followed by 90 response rows, status accepted through the mounted banner's history.
- Before tap: viewport 26, target 3. Actual Orca emulator tap at (0.73611, 0.10625) moved viewport to 3. Buffer row reads `> Readable Android prompt`; screenshot visibly shows that prompt at the first terminal row.
- Two-turn check: scroll to row 10 selects `Readable Android prompt`; return to bottom selects `Second readable prompt`.
- JSON results retained alongside screenshot. This verifies rendered text, touch, banner jump and historical context. It is not a live provider-hook integration or production WebGL rendering verification.

Setup: Nix flake SDK, KVM, test-owned AVD orca_prompt_font at `.cache/prompt-font/avd`, emulator-5582, 2048 MB, no window/audio/snapshot. Isolated desktop profile /tmp/orca-prompt-check, desktop CDP 9239, Metro 8097, forwarded Android WebView CDP 9238. Used version-matched orca-emulator-android skill and Orca tap/screenshot commands. No desktop focus activation.

Cleanup: helper stopped, emulator shut down, isolated runtime and test Metro stopped, test AVD/cache including pairing secrets removed. No feature code changed for this validation.
