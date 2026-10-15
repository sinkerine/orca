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
electron-vm --run ID logs setup -n 40
electron-vm --run ID logs app -n 60
electron-vm --run ID exec 'systemctl status electron-app --no-pager; df -h / /job; free -h'
```

A failed first launch can leave the VM running. Repair and retry there rather than repeating the dependency download. Preserve logs and screenshots outside the job directory before another `start`, which replaces it. Always run `electron-vm --run ID stop` when finished, then `electron-vm --run ID clean` after preserving evidence. Use the id returned by your own start for every subsequent command; never target another run.

## Resolve the guest PATH

`electron-vm exec` uses a narrower PATH than `electron-app.service`. Git, Node, pnpm, Python, make, and the compiler can exist in `/nix/store` while `command -v` cannot find them. Inspect the service's environment:

```bash
electron-vm --run ID exec 'systemctl cat electron-app'
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
electron-vm --run ID cdp targets
electron-vm --run ID cdp snapshot
electron-vm --run ID cdp eval '({title: document.title, ready: document.readyState})'
```

A successful `cdp click` only proves input was sent. Assert the resulting dialog or DOM state. In the observed hidden-window run, coordinate input reported success without opening a dialog, while calling the existing button's DOM `click()` through `cdp eval` opened it. Describe this as a programmatic UI check; it does not establish native pointer/focus behavior. Do not reveal the window to work around it.

## Memory and filesystem limits

This VM had 8 GiB RAM and a roughly 4 GiB root filesystem backed by memory. Dependencies consumed about 2.5 GiB. Running a production E2E build beside the dev app caused an OOM kill of the renderer; a later production build also exceeded memory with the app stopped.

Before a large build, inspect both RAM and disk usage. Run builds and app validation sequentially, with one Playwright worker. Neither reducing V8's heap nor stopping the app alone guarantees the build will fit. Larger memory sizes are recommendations, not measured minimums: try 12 GiB for sequential builds or 16 GiB for more headroom.

### Keep writable files on host storage

The installed harness stages source at `/job/src`, then copies it to `~/app` before setup. `/job` is a writable 9p share of the host's `/var/tmp/electron-vm/slot-N` directory. Work directly in `/job/src` to keep dependencies and build outputs off the guest's RAM-backed root. Both setup and launch must select that directory; a `cd` in setup does not carry into launch. Do this before installing, never by relocating a live app.

Check the host backing filesystem first:

```bash
findmnt -T /var/tmp/electron-vm -o TARGET,SOURCE,FSTYPE
```

On the inspected host this reports ZFS. A host tmpfs would consume host memory instead. Host-backed files can still use reclaimable page cache, and Node, native bundlers, Electron, and additional guest Nix packages still consume guest RAM. The 9p share may slow small-file I/O; check native-module compilation, executable permissions, symlinks, and file watching before treating this as a default.

Candidate dev-launch recipe (checked against the installed launcher, not yet validated by an Orca run):

```bash
electron-vm start --no-wait \
  --setup '
    cd /job/src
    mkdir -p /job/work/cache /job/work/pnpm-store
    export XDG_CACHE_HOME=/job/work/cache
    export npm_config_cache=/job/work/cache/npm
    export ELECTRON_CACHE=/job/work/cache/electron
    export ORCA_BACKGROUND_LAUNCH=1
    unset ELECTRON_OVERRIDE_DIST_PATH ELECTRON_RUN_AS_NODE
    nix shell nixpkgs#unzip -c bash -c "pnpm install --frozen-lockfile --store-dir /job/work/pnpm-store && pnpm run ensure:electron-runtime"
  ' \
  --cmd '
    cd /job/src
    export XDG_CACHE_HOME=/job/work/cache
    export npm_config_cache=/job/work/cache/npm
    export ELECTRON_CACHE=/job/work/cache/electron
    export ORCA_BACKGROUND_LAUNCH=1 REMOTE_DEBUGGING_PORT=9222
    node config/scripts/run-electron-vite-dev.mjs
  '
```

`unzip` is an extra guest dependency. The service already supplies Node, pnpm, Python, make, and a compiler; recheck the current service PATH and package requirements if setup fails. Setup clears the Electron override; the harness supplies its CDP wrapper separately at launch. `--no-wait` avoids waiting for a visible window because Orca must remain hidden. Poll your run's setup/app logs and CDP readiness instead of revealing the window.

The harness still makes its initial source-only copy in `~/app`. This recipe avoids installing there but does not remove that copy. `exec` also defaults to `~/app`, so explicitly use `cd /job/src` in every later build/test command.

For E2E, build the current source with `electron-vite build --mode e2e` and build the required CLI/relay/web outputs before testing. Do not keep the dev app running alongside a build or the test suite. Use `ORCA_BACKGROUND_LAUNCH=1`, `--project electron-headless`, and `--workers=1`; use `SKIP_BUILD=1` only when the required outputs exist and match the source under test. Do not use the CDP Electron wrapper for Node/native checks or Playwright launches.

Validate with CDP targets, DOM, and a hidden-renderer screenshot, plus a terminal shell prompt. Record `free -h`, `df -h / /job`, and directory sizes before/after setup and build; verify file watching separately. Do not claim this makes builds fit in 8 GiB until measured. Preserve cited evidence outside the slot, then stop and clean your own run. Files under `/job` survive VM shutdown and remain until cleanup or slot reuse.

During a long run, `electron-vm --run ID exec 'nix store gc'` can reclaim unused guest Nix packages. Never run host-wide garbage collection.

Confirm OOM evidence using `electron-vm --run ID logs vm` (or unprivileged `dmesg` if permitted). The guest has no sudo/root access. A kernel `Out of memory: Killed process ...` plus renderer `reason: 'killed', exitCode: 9` is an environmental termination, not proof of an Orca application exception. Report the failed validation and its cause explicitly. GPU initialization failures are expected in this software-rendered VM.

## Verification and reporting

Verify startup with a CDP target, rendered DOM, and a CDP screenshot. Check node-pty by opening a terminal and observing a shell prompt in the expected workspace directory. Recheck app logs for renderer termination, uncaught exceptions, and unhandled rejections.

Keep setup failures, programmatic store/API checks, DOM-driven UI checks, and completed E2E assertions distinct in the report. A suite that fails during global setup has not tested its selected features. Do not claim all worktree features pass or that Orca cannot crash based on startup alone.
