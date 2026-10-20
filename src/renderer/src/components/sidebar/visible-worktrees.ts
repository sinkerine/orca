import {
  getPublishedVisibleWorktreeIds,
  getPublishedVisibleWorktreeShortcutTargets,
  type VisibleWorktreeShortcutTarget
} from './rendered-sidebar-worktree-publication'
export {
  getPublishedVisibleWorktreeShortcutTargets,
  setVisibleWorktreeIds,
  setVisibleWorktreeShortcutTargets,
  type VisibleWorktreeShortcutTarget
} from './rendered-sidebar-worktree-publication'
export type { SidebarFilterState } from './sidebar-filter-actions'
export {
  computeVisibleWorktreeIds,
  computeVisibleWorktrees,
  type VisibleWorktreeOptions
} from './compute-visible-worktrees'
import { computeVisibleWorktreeIds } from './compute-visible-worktrees'
export { sidebarHasActiveFilters } from './sidebar-filter-actions'
import {
  getVisibleWorkspaceHostIdSet,
  worktreeMatchesVisibleHost
} from './visible-worktree-host-scope'
import {
  buildWorktreeComparator,
  sortWorktreesSmart
} from '../../../../shared/sidebar-list/smart-sort'
export {
  EMPTY_STRUCTURED_CHAT_WORKTREE_IDS,
  getWorktreeIdsWithStructuredChat
} from './visible-worktree-activity-inputs'
import { buildVisibleWorktreeOptionsFromState } from './visible-worktree-options-from-state'
import { useAppStore } from '@/store'
import { getAllWorktreesFromState, getRepoMapFromState } from '@/store/selectors'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import {
  computeRenderedSidebarWorktreeOrder,
  computeRenderedSidebarWorktrees
} from './rendered-sidebar-worktree-order'
export { buildVisibleWorktreeOptionsFromState } from './visible-worktree-options-from-state'


export function getVisibleWorktreeIds(): string[] {
  const published = getPublishedVisibleWorktreeIds()
  if (published) {
    return published
  }

  const state = useAppStore.getState()
  const allWorktrees = getAllWorktreesFromState(state).filter((w) => !w.isArchived)

  const repoMap = getRepoMapFromState(state)

  let sortedIds: string[]

  if (state.sortBy === 'smart') {
    sortedIds = sortWorktreesSmart(
      allWorktrees,
      state.tabsByWorktree,
      repoMap,
      state.agentStatusByPaneKey,
      state.runtimePaneTitlesByTabId,
      state.ptyIdsByTabId,
      state.migrationUnsupportedByPtyId,
      state.terminalLayoutsByTabId
    ).map((w) => w.id)
  } else {
    // Why empty map: non-smart branches don't read attentionByWorktree, but
    // the param is required to keep smart-mode callers honest at the type level.
    const sorted = [...allWorktrees].sort(
      buildWorktreeComparator(state.sortBy, repoMap, Date.now(), new Map())
    )
    sortedIds = sorted.map((w) => w.id)
  }

  const visibleIds = computeVisibleWorktreeIds(
    state.worktreesByRepo,
    sortedIds,
    buildVisibleWorktreeOptionsFromState(state, repoMap)
  )

  const visibleIdRank = new Map(visibleIds.map((id, index) => [id, index]))
  const visibleHostIds = getVisibleWorkspaceHostIdSet(state)
  const defaultHostId = getSettingsFocusedExecutionHostId(state.settings)
  const visibleWorktrees = allWorktrees
    .filter(
      (worktree) =>
        visibleIdRank.has(worktree.id) &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, repoMap, defaultHostId)
    )
    .sort((a, b) => (visibleIdRank.get(a.id) ?? 0) - (visibleIdRank.get(b.id) ?? 0))
  return computeRenderedSidebarWorktreeOrder(state, visibleWorktrees)
}

export function getVisibleWorktreeShortcutTargets(): VisibleWorktreeShortcutTarget[] {
  const publishedTargets = getPublishedVisibleWorktreeShortcutTargets()
  if (publishedTargets) {
    return publishedTargets
  }
  const state = useAppStore.getState()
  const visibleIdRank = new Map(getVisibleWorktreeIds().map((id, index) => [id, index]))
  const repoMap = getRepoMapFromState(state)
  const visibleHostIds = getVisibleWorkspaceHostIdSet(state)
  const defaultHostId = getSettingsFocusedExecutionHostId(state.settings)
  const worktrees = getAllWorktreesFromState(state)
    .filter(
      (worktree) =>
        !worktree.isArchived &&
        visibleIdRank.has(worktree.id) &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, repoMap, defaultHostId)
    )
    .sort((a, b) => (visibleIdRank.get(a.id) ?? 0) - (visibleIdRank.get(b.id) ?? 0))
  return computeRenderedSidebarWorktrees(state, worktrees).map((worktree) => ({
    id: worktree.id,
    ...(worktree.hostId ? { executionHostId: worktree.hostId } : {})
  }))
}
