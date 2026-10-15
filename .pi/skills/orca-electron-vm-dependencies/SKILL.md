---
name: orca-electron-vm-dependencies
description: Fix Orca dependency and startup failures in electron-vm-test, including missing unzip, guest PATH, Electron binary installation, native node-pty rebuilds, and CDP port selection. Use before launching Orca in a fresh Electron VM or when its setup fails.
---

# Orca Electron VM dependencies

Use alongside `electron-vm-test`. Run all app and test launches with `ORCA_BACKGROUND_LAUNCH=1`. Use CDP for Orca UI checks and keep the renderer hidden. Changes below belong only in the disposable guest; do not change Orca's dependency versions or launch policy to accommodate the VM.

## Diagnose first

Read `package.json` and the current native-runtime scripts before selecting launch commands. Inspect:

```bash
electron-vm status
electron-vm logs setup -n 40
electron-vm logs app -n 60
electron-vm exec 'systemctl status electron-app --no-pager; df -h / /job; free -h'
```

A failed first launch can leave the VM running. Repair and retry there rather than repeating the dependency download. Preserve logs and screenshots outside the job directory before another `start`, which replaces it. Always run `electron-vm stop` when finished.

## Resolve the guest PATH

`electron-vm exec` uses a narrower PATH than `electron-app.service`. Git, Node, pnpm, Python, make, and the compiler can exist in `/nix/store` while `command -v` cannot find them. Inspect the service's environment:

```bash
electron-vm exec 'systemctl cat electron-app'
```

For a retry script, copy the service's `Environment="PATH=..."` value into an explicit PATH export and prepend the directory containing any added tools. Preserve the existing PATH as well. Do not hardcode Nix store hashes from another VM. Configure Git's test identity inside the guest before creating fixture commits.

## Supply unzip before installing Electron

Observed failure on `custom`: Orca's installer reached `extractElectronArchive` and failed with `spawnSync unzip ENOENT`. `pnpm install` completing does not prove that the Electron binary is installed.

Prefer an available `unzip` binary. If none is installed, create a guest-only executable named `unzip` using the guest's Python interpreter. The following implements the installer's observed `unzip -q ARCHIVE -d DIRECTORY` call and restores Unix executable permissions. Recheck the installer arguments if they change.

```python
#!/absolute/path/to/guest/python3
import os
import sys
import zipfile

args = sys.argv[1:]
archive = next(arg for arg in args if arg.endswith('.zip'))
destination = args[args.index('-d') + 1]
with zipfile.ZipFile(archive) as bundle:
    bundle.extractall(destination)
    for entry in bundle.infolist():
        mode = entry.external_attr >> 16
        if mode:
            os.chmod(os.path.join(destination, entry.filename), mode)
```

Replace the shebang with the actual guest Python path, make the file executable, and prepend its directory to PATH. Use this only for the Electron archive downloaded by the existing installer.

## Rebuild native modules without the CDP wrapper

The VM sets `ELECTRON_OVERRIDE_DIST_PATH` to a launcher that adds CDP flags. Native-runtime checks can run Electron as Node; the wrapper then produces `bad option: --remote-debugging-port=9222` and `bad option: --force-renderer-accessibility`.

Save the wrapper path, clear the override while installing/rebuilding, then restore it only for the app launch:

```bash
# Inside the guest, with the full build-tool PATH and unzip available:
vm_electron_wrapper="$ELECTRON_OVERRIDE_DIST_PATH"
unset ELECTRON_OVERRIDE_DIST_PATH ELECTRON_RUN_AS_NODE
export ORCA_BACKGROUND_LAUNCH=1
pnpm run ensure:electron-runtime
export ELECTRON_OVERRIDE_DIST_PATH="$vm_electron_wrapper"
export REMOTE_DEBUGGING_PORT=9222
node config/scripts/run-electron-vite-dev.mjs
```

If an `exec` shell does not have the override, obtain its value from the guest's `electron-app.service` ExecStart script. Do not assume it is exported in interactive shells.

Use `ensure:electron-runtime`; it applies Orca's patched node-pty build requirements. An error such as `not found: make` means the retry PATH still lacks build tools. Preserve a background retry's stdout/stderr in `/job/out/retry-app.log`, launch it detached with stdin closed, and poll its log rather than blocking the session.

Stop a failed `electron-app.service` before a manual retry. Do not restart that service blindly: its ExecStart copies the source and installs dependencies again.

## CDP and hidden renderers

Orca's dev runner chooses its own debugging port unless `REMOTE_DEBUGGING_PORT=9222` is set. The VM CDP helper expects port 9222. Check the dev-runner log, then run:

```bash
electron-vm cdp targets
electron-vm cdp snapshot
electron-vm cdp eval '({title: document.title, ready: document.readyState})'
```

A successful `cdp click` only proves input was sent. Assert the resulting dialog or DOM state. In the observed hidden-window run, coordinate input reported success without opening a dialog, while calling the existing button's DOM `click()` through `cdp eval` opened it. Describe this as a programmatic UI check; it does not establish native pointer/focus behavior. Do not reveal the window to work around it.

## Memory and filesystem limits

This VM had 8 GiB RAM and a roughly 4 GiB root filesystem backed by memory. Dependencies consumed about 2.5 GiB. Running a production E2E build beside the dev app caused an OOM kill of the renderer; a later production build also exceeded memory with the app stopped.

Before a large build, inspect both RAM and disk usage. Run builds and app validation sequentially. If available, stage dependencies/build outputs on the disk-backed `/job` filesystem before installing, or use a VM with more memory. Preserve the expected working-directory layout; do not move a live app directory. Neither reducing V8's heap nor stopping the app alone guarantees the build will fit.

Confirm OOM evidence using `sudo dmesg` inside the guest or `electron-vm logs vm`. A kernel `Out of memory: Killed process ...` plus renderer `reason: 'killed', exitCode: 9` is an environmental termination, not proof of an Orca application exception. Report the failed validation and its cause explicitly. GPU initialization failures are expected in this software-rendered VM.

## Verification and reporting

Verify startup with a CDP target, rendered DOM, and a CDP screenshot. Check node-pty by opening a terminal and observing a shell prompt in the expected workspace directory. Recheck app logs for renderer termination, uncaught exceptions, and unhandled rejections.

Keep setup failures, programmatic store/API checks, DOM-driven UI checks, and completed E2E assertions distinct in the report. A suite that fails during global setup has not tested its selected features. Do not claim all worktree features pass or that Orca cannot crash based on startup alone.
