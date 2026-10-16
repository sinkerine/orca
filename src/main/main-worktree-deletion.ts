import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Repo } from '../shared/repo-types'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import type { RuntimeStore } from './runtime/runtime-store-contract'
import { resolveProjectPrimaryWorkspace } from '../shared/project-primary-workspace'
import { getRepoExecutionHostId } from '../shared/execution-host'
import { migrateMainWorktree } from './git/main-worktree-migration'
import { finishMigrationJournal } from './git/main-worktree-migration-journal'
import { markMainMigrationUnavailable } from './git/main-worktree-migration-state'
import { bumpWorktreeScanGeneration } from './git/worktree-scan-cache'

/** Called only under the existing durable primary-removal reservation. */
export function prepareFormerMainWorktreeDeletion(args: {
  store: RuntimeStore
  repo: Repo
  worktreePath: string
  registeredWorktrees: readonly GitWorktreeInfo[]
  force: boolean
  wslDistro?: string
}): Repo {
  const { store, repo, registeredWorktrees, worktreePath } = args
  if (!registeredWorktrees.some((row) => row.path === worktreePath && row.isMainWorktree)) {
    return repo
  }
  if (getRepoExecutionHostId(repo) !== 'local' || args.wslDistro || process.platform === 'win32') {
    throw new Error(
      'Deleting the original checkout after primary reassignment is supported only for native macOS and Linux repositories. The repository was kept.'
    )
  }
  const project = store.getProjects?.().find((entry) => entry.sourceRepoIds.includes(repo.id))
  const primary = project?.primaryWorkspace
  const meta = primary ? store.getWorktreeMeta(primary.worktreeId) : undefined
  const resolved =
    project && primary && meta
      ? resolveProjectPrimaryWorkspace(project, [
          {
            id: primary.worktreeId,
            path: primary.path,
            instanceId: meta.instanceId,
            hostId: meta.hostId ?? 'local',
            peerFingerprint: primary.peerFingerprint
          }
        ])
      : undefined
  if (
    !resolved ||
    !primary ||
    primary.hostId !== 'local' ||
    primary.path === worktreePath ||
    !primary.worktreeId.startsWith(`${repo.id}::`) ||
    !registeredWorktrees.some(
      (row) => row.path === primary.path && !row.isMainWorktree && !row.isBare && !row.prunable
    )
  ) {
    throw new Error(
      'Select an available linked checkout in this repository as primary before deleting the original checkout.'
    )
  }
  if (!store.rebindLocalRepositoryAnchor || !store.getProfileStorageDirectory) {
    throw new Error('Repository migration persistence is unavailable')
  }
  assertRepositoryNotSharedAcrossProfiles(store.getProfileStorageDirectory(), repo.path)
  const result = migrateMainWorktree({
    repoId: repo.id,
    oldPath: worktreePath,
    newPath: primary.path,
    profileDirectory: store.getProfileStorageDirectory(),
    force: args.force
  })
  try {
    store.rebindLocalRepositoryAnchor(repo.id, worktreePath, primary.path)
  } catch (error) {
    markMainMigrationUnavailable(
      registeredWorktrees.map((row) => row.path),
      `${result.journalPath}: ${String(error)}`
    )
    throw new Error(
      `Git migration needs attention: its repository path could not be saved. Restart Orca to recover from ${result.journalPath}. No checkout was deleted.`
    )
  }
  bumpWorktreeScanGeneration(worktreePath)
  bumpWorktreeScanGeneration(primary.path)
  finishMigrationJournal(result.journalPath, result.journal)
  return { ...repo, path: primary.path }
}

function assertRepositoryNotSharedAcrossProfiles(profileDirectory: string, repoPath: string): void {
  const profilesDirectory = dirname(profileDirectory)
  if (basename(profilesDirectory) !== 'profiles') {
    return
  }
  const candidates = readdirSync(profilesDirectory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && join(profilesDirectory, entry.name) !== profileDirectory
    )
    .map((entry) => join(profilesDirectory, entry.name, 'orca-data.json'))
  for (const file of candidates) {
    if (!existsSync(file)) {
      continue
    }
    let state: { repos?: Repo[] }
    try {
      state = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      throw new Error(
        'Another profile could not be checked for repository references; the repository was kept.'
      )
    }
    if (
      Array.isArray(state.repos) &&
      state.repos.some(
        (entry) => entry.path === repoPath && getRepoExecutionHostId(entry) === 'local'
      )
    ) {
      throw new Error(
        'This repository is also imported in another profile. Remove that import before deleting the original checkout.'
      )
    }
  }
}
