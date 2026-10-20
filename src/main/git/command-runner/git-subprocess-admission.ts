import { assertMainMigrationAvailable } from '../main-worktree-migration-state'
import { trackGitAdmission } from '../main-worktree-migration-activity'
import {
  GitAdmissionScheduler,
  type GitAdmissionGrant,
  type GitAdmissionRequest
} from '../../../shared/git-admission-scheduler'
import { resolveGitAdmissionTier } from './git-operation-executor'
export * from '../../../shared/git-admission-scheduler'

let scheduler = new GitAdmissionScheduler()

export function acquireGitAdmission(request: GitAdmissionRequest): Promise<GitAdmissionGrant> {
  try {
    assertMainMigrationAvailable(request.cwd)
  } catch (error) {
    return Promise.reject(error)
  }
  if (process.env.ORCA_GIT_ADMISSION_DISABLED === '1') {
    return Promise.resolve({ queueWaitMs: 0, release: trackGitAdmission(() => {}) })
  }
  return scheduler
    .acquire({ ...request, tier: resolveGitAdmissionTier(request.tier) })
    .then((grant) => ({ ...grant, release: trackGitAdmission(grant.release) }))
}

export function _resetGitAdmissionForTests(replacement = new GitAdmissionScheduler()): void {
  scheduler = replacement
}

export function _gitAdmissionSnapshotForTests(): ReturnType<GitAdmissionScheduler['snapshot']> {
  return scheduler.snapshot()
}
