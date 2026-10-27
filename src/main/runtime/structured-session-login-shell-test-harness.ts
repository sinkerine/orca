/**
 * A structured session's child env beside a HOME whose login profiles put a stand-in global `orca`
 * first, as `/usr/local/bin` often is. Shared by the bash suite (every lane) and the zsh suite
 * (the real-shell lane, which installs zsh).
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { runProcess } from '@orca/process-host'
import { sealedChildEnv } from './structured-session-child-env.test-support'

const SESSION_ID = 'f7a1c0de-1111-4222-8333-444455556666'

export type LoginShellHarness = {
  /** Runs a shell with the structured session's env and returns its stdout. */
  run: (spec: { program: string; args: [flag: '-lc' | '-c', script: string] }) => Promise<string>
  dispose: () => void
}

function writeStub(path: string, says: string): void {
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${says}'\n`)
  chmodSync(path, 0o755)
}

export function createLoginShellHarness(): LoginShellHarness {
  const root = mkdtempSync(join(tmpdir(), 'orca-login-shell-cli-'))
  const home = join(root, 'home')
  const globalBin = join(root, 'global-bin')
  const userData = join(root, 'user-data')
  const appCliBin = join(userData, 'cli', 'bin')
  for (const dir of [home, globalBin, appCliBin]) {
    mkdirSync(dir, { recursive: true })
  }
  writeStub(join(globalBin, 'orca'), 'global')
  writeStub(join(appCliBin, 'orca'), 'app')
  writeStub(join(appCliBin, 'orca-dev'), 'app')
  const prependGlobal = `export PATH="${globalBin}:$PATH"\n`
  writeFileSync(join(home, '.zprofile'), prependGlobal)
  writeFileSync(join(home, '.bash_profile'), prependGlobal)
  installFakeAppEnvironment({ isPackaged: () => false, getPath: () => userData })
  const env = sealedChildEnv(SESSION_ID, { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin' })
  return {
    run: async (spec) => {
      const result = await runProcess({
        ...spec,
        env: { ...env, __ETC_PROFILE_DONE: '1', __ETC_ZSHENV_SOURCED: '1' },
        timeoutMs: 5_000
      })
      if (result.code !== 0) {
        throw new Error(`Login-shell probe failed: ${result.stderr}`)
      }
      return result.stdout
    },
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}
