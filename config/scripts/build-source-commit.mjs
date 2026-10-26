import { execFileSync } from 'node:child_process'

/**
 * The full commit this build is made from. Official skill installs pin to it, so the
 * skills an Orca build installs are the ones it bundles on every release channel.
 */
export function resolveBuildSourceCommit({
  env = process.env,
  readCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} = {}) {
  let commit = ''
  try {
    commit = env.ORCA_BUILD_COMMIT ?? readCommit()
  } catch (error) {
    throw new Error(
      `Could not read the source commit with \`git rev-parse HEAD\`: ${
        error instanceof Error ? error.message : String(error)
      }. Build from a git checkout or set ORCA_BUILD_COMMIT to the full source commit.`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Build source commit "${commit}" is not a full commit hash.`)
  }
  return commit
}
