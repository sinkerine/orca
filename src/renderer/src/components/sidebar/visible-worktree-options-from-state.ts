import { resolveProjectPrimaryWorkspace, hasSavedPrimaryWorkspace } from '../../../../shared/project-primary-workspace'
import { getPrimaryWorktreeIdentity } from './visible-worktree-options'
import { selectEffectiveFilterRepoIds } from './project-filter-resolution'
import type { Repo } from '../../../../shared/repo-types'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import type { useAppStore } from '@/store'
import { getWorktreeIdsWithStructuredChat } from './visible-worktree-activity-inputs'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from '../../../../shared/workspace-creator-visibility'
import type { VisibleWorktreeOptions } from './compute-visible-worktrees'

/**
 * Read the store into the filter inputs `computeVisibleWorktrees` decides from.
 *
 * Why separate from the filter itself: this is the only part of the pipeline that touches the
 * store, so keeping it here leaves the filter a pure function of its options — which is what lets
 * the sidebar, Cmd+J and the Cmd+1–9 handler all reuse it without a React render.
 */
export function buildVisibleWorktreeOptionsFromState(
  state: ReturnType<typeof useAppStore.getState>,
  repoMap: Map<string, Repo>
): VisibleWorktreeOptions {
  const primaryWorktreeIdentities = new Set<string>()
  const savedPrimaryRepoIds = new Set<string>()
  for (const project of state.projects) {
    if (hasSavedPrimaryWorkspace(project)) {project.sourceRepoIds.forEach((id) => savedPrimaryRepoIds.add(id))}
    const primary = resolveProjectPrimaryWorkspace(project, Object.values(state.worktreesByRepo).flat())
    if (primary) {primaryWorktreeIdentities.add(getPrimaryWorktreeIdentity(primary))}
  }
  return {
    primaryWorktreeIdentities,
    savedPrimaryRepoIds,
    filterRepoIds: selectEffectiveFilterRepoIds(state),
    showSleepingWorkspaces: state.showSleepingWorkspaces,
    tabsByWorktree: state.tabsByWorktree,
    ptyIdsByTabId: state.ptyIdsByTabId,
    browserTabsByWorktree: state.browserTabsByWorktree,
    worktreeIdsWithLiveAgent: getWorktreeIdsWithLiveAgent(
      state.agentStatusByPaneKey,
      state.tabsByWorktree,
      Date.now()
    ),
    worktreeIdsWithStructuredChat: getWorktreeIdsWithStructuredChat(state.unifiedTabsByWorktree),
    hideDefaultBranchWorkspace: state.hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces: state.hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces: state.hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces: state.hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices: state.hideWorkspacesFromOtherDevices,
    pairedDeviceIdsByEnvironment: state.hideWorkspacesFromOtherDevices
      ? getPairedDeviceIdsByEnvironment(
          state.runtimeEnvironments,
          state.runtimeStatusByEnvironmentId
        )
      : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    alwaysShowDefaultBranchWorkspace: state.alwaysShowDefaultBranchWorkspace,
    repoMap,
    workspaceHostScope: state.workspaceHostScope,
    visibleWorkspaceHostIds: state.visibleWorkspaceHostIds,
    defaultHostId: getSettingsFocusedExecutionHostId(state.settings),
    worktreeLineageById: state.worktreeLineageById,
    preserveLineageParentOrder: state.sortBy === 'manual'
  }
}
