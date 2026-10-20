import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { isDefaultBranchWorkspace } from '../../../../shared/worktree/workspace-kinds'
import { clearProjectFilterHidingRepo, type ProjectFilterInputs } from './project-filter-resolution'

export type AddRepoSkipFinalizationState = Omit<ProjectFilterInputs, 'repos'> & {
  activeRepoId: string | null
  showActiveOnly: boolean
  hideDefaultBranchWorkspace: boolean
  showSleepingWorkspaces: boolean
  alwaysShowDefaultBranchWorkspace: boolean
  repos: readonly Pick<Repo, 'id' | 'kind' | 'projectGroupId'>[]
  worktreesByRepo: Record<string, Worktree[]>
  setActiveRepo: (repoId: string | null) => void
  setFilterRepoIds: (repoIds: string[]) => void
  setFilterGroupIds: (groupIds: string[]) => void
  setShowActiveOnly: (value: boolean) => void
  setHideDefaultBranchWorkspace: (value: boolean) => void
  setAlwaysShowDefaultBranchWorkspace: (value: boolean) => void
}

export function finalizeImportedRepoAfterSkip(
  state: AddRepoSkipFinalizationState,
  importedRepoId: string
): void {
  const importedWorktrees = (state.worktreesByRepo[importedRepoId] ?? []).filter(
    (worktree) => !worktree.isArchived
  )
  const importedRepo = state.repos.find((repo) => repo.id === importedRepoId)

  // Why: Skip means "do not open or create a worktree", not "hide the
  // imported project behind sidebar filters so it looks like nothing landed."
  if (state.activeRepoId !== importedRepoId) {
    state.setActiveRepo(importedRepoId)
  }
  clearProjectFilterHidingRepo(state, importedRepoId)
  if (state.showActiveOnly) {
    state.setShowActiveOnly(false)
  }
  if (
    importedWorktrees.length > 0 &&
    state.hideDefaultBranchWorkspace &&
    importedWorktrees.every((worktree) => isDefaultBranchWorkspace(worktree, importedRepo))
  ) {
    state.setHideDefaultBranchWorkspace(false)
  }
  // Why: with "Hide sleeping" on, a freshly imported project has no live PTY
  // yet, so the opted-out exemption would leave it invisible on arrival.
  if (
    importedWorktrees.length > 0 &&
    state.alwaysShowDefaultBranchWorkspace === false &&
    !state.showSleepingWorkspaces &&
    importedWorktrees.every((worktree) => worktree.isMainWorktree)
  ) {
    state.setAlwaysShowDefaultBranchWorkspace(true)
  }
}
