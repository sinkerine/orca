import type { RuntimeLeafRecord } from './runtime-terminal-state-records'
import { AgentTransitionDetector } from '../agent-hooks/agent-transition-detector'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../shared/runtime-session-contracts'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { OrcaRuntimeWithMigrationCatalog } from './orca-runtime-migration-catalog'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'
import type { AgentStatusStoreView } from './sidebar-inputs/workspace-activity-facts-producer'
import {
  TerminalAgentPhonePush,
  type TerminalAgentWorkspaceLabels
} from './terminal-agent-phone-push'

/**
 * Owns the runtime's agent transition detector, and the phone push it drives while no window
 * runs here. Both run on every host and in every build.
 */
export abstract class OrcaRuntimeWithAgentTransitions extends OrcaRuntimeWithMigrationCatalog {
  readonly agentTransitions = new AgentTransitionDetector({
    resolveTabWorktreeId: (tabId) => this.tabs.get(tabId)?.worktreeId,
    subscribeToPtyExit: (ptyId, listener) => this.subscribeToPtyExit(ptyId, listener),
    now: Date.now
  })
  private readonly terminalAgentPhonePush = new TerminalAgentPhonePush({
    // A desktop that has not shown its window yet counts as having one: that window seeds what it
    // missed rather than announcing it, so the phone hears no more than it does today.
    hasWindow: () =>
      this.authoritativeWindowId === null
        ? this.rendererGraphEpoch === 0
        : this.authoritativeWindowId !== HEADLESS_RUNTIME_WINDOW_ID,
    readNotificationSettings: () => this.store?.getSettings().notifications,
    readWorkspaceLabels: (worktreeId, paneKey) =>
      this.readTerminalAgentWorkspaceLabels(worktreeId, paneKey),
    isWorkspaceMuted: (worktreeId) => this.isWorkspaceNotificationMuted(worktreeId),
    readHookRow: (paneKey) => this.agentTransitions.latestRow(paneKey),
    translate: (key, fallback) =>
      getRuntimeDesktopSurface().translateNotification?.(key, fallback) ?? fallback,
    dispatch: (event) => this.mobileNotifications.dispatch(event),
    setTimer: (run, delayMs) => {
      // A pending finish must never hold the process open at quit.
      const timer = setTimeout(run, delayMs)
      timer.unref?.()
      return { cancel: () => clearTimeout(timer) }
    },
    now: Date.now
  })

  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithMigrationCatalog>) {
    super(...args)
    this.agentTransitions.subscribe((change) => this.terminalAgentPhonePush.observe(change))
  }

  /** Attaches the detector; layers above subscribe their readers first. */
  attachAgentStatusStore(store: AgentStatusStoreView): () => void {
    return this.agentTransitions.attach(store)
  }

  // The window's labels (getNotificationWorkspaceLabels), read from this host's own records.
  private readTerminalAgentWorkspaceLabels(
    worktreeId: string,
    paneKey: string
  ): TerminalAgentWorkspaceLabels {
    const store = this.store
    const tabId = parsePaneKey(paneKey)?.tabId
    const fallback =
      (tabId ? this.tabs.get(tabId)?.title?.trim() : undefined) ||
      this.agentTransitions.latestRow(paneKey)?.agentType ||
      'workspace'
    const scope = parseWorkspaceKey(worktreeId)
    if (scope?.type === 'folder') {
      const folder = store?.getFolderWorkspaces?.().find((f) => f.id === scope.folderWorkspaceId)
      const group = folder
        ? store?.getProjectGroups?.().find((item) => item.id === folder.projectGroupId)
        : undefined
      return { repoLabel: group?.name, worktreeLabel: folder?.name || fallback }
    }
    const id = scope?.type === 'worktree' ? scope.worktreeId : worktreeId
    // The listing is a cache a catalog change empties; the persisted record names it meanwhile.
    const listed = this.resolvedWorktrees.peek()?.worktrees.find((item) => item.id === id)
    const meta = listed ? undefined : store?.getWorktreeMeta(id)
    const repoId = listed?.repoId ?? (meta ? getRepoIdFromWorktreeId(id) : undefined)
    const repo = repoId ? store?.getRepo(repoId) : undefined
    return {
      repoLabel: repo?.displayName,
      worktreeLabel: listed?.displayName || listed?.branch || meta?.displayName || fallback
    }
  }
  resolveOwnerWindowIdForPtyId(ptyId: string): number | null {
    return this.ptyOwnerWindowById.get(ptyId) ?? null
  }

  resolvePtyIdsForOwnerWindow(windowId: number): string[] {
    return [...this.ptyOwnerWindowById].filter(([, owner]) => owner === windowId).map(([id]) => id)
  }

  registerPtyOwnerWindow(ptyId: string, windowId: number): void {
    if (this.suppressedPtyOwnerWindowIds.has(ptyId)) {
      return
    }
    this.transientPtyOwnerWindowById.set(ptyId, windowId)
    const previousWindowId = this.ptyOwnerWindowById.get(ptyId) ?? null
    this.ptyOwnerWindowById.set(ptyId, windowId)
    if (previousWindowId !== windowId) {
      this.onPtyOwnerWindowsChanged?.([{ ptyId, previousWindowId, nextWindowId: windowId }])
    }
  }

  claimPtyOwnerWindow(
    ptyId: string,
    windowId: number
  ): 'claimed' | 'already-owner' | 'unavailable' {
    const publication = this.windowGraphPublications.get(windowId)
    if (
      !publication ||
      ![...publication.leafKeys].some((key) => this.leaves.get(key)?.ptyId === ptyId)
    ) {
      return 'unavailable'
    }
    const previousWindowId = this.ptyOwnerWindowById.get(ptyId) ?? null
    if (previousWindowId === windowId) {
      this.explicitPtyOwnerWindowById.set(ptyId, windowId)
      return 'already-owner'
    }
    this.explicitPtyOwnerWindowById.set(ptyId, windowId)
    this.rebuildOwnerWindowIndexes()
    return 'claimed'
  }

  listPtyOwnerWindows(): { ptyId: string; windowId: number }[] {
    return Array.from(this.ptyOwnerWindowById, ([ptyId, windowId]) => ({ ptyId, windowId }))
  }

  senderWindowOwnsTerminalHandle(handle: string, senderWindowId: number): boolean {
    const leaf = this.resolveLeafForHandle(handle)
    return leaf?.ptyId != null && this.resolveOwnerWindowIdForPtyId(leaf.ptyId) === senderWindowId
  }

  resolveOwnerWindowIdForTabId(tabId: string): number | null {
    return this.tabOwnerWindowById.get(tabId) ?? null
  }
  resolveOwnerWindowIdForWorktreeTab(worktreeId: string, tabId: string): number | null {
    return this.tabOwnerWindowByWorktreeAndTabId.get(`${worktreeId}\0${tabId}`) ?? null
  }
  resolveOwnerWindowIdForLeaf(tabId: string, leafId: string): number | null {
    return this.leafOwnerWindowByKey.get(this.getLeafKey(tabId, leafId)) ?? null
  }
  resolveOwnerWindowIdForLeafId(leafId: string): number | null {
    for (const [key, owner] of this.leafOwnerWindowByKey) {
      if (key.endsWith(`::${leafId}`)) {
        return owner
      }
    }
    return null
  }
  resolveOwnerWindowIdForBrowserPageId(pageId: string): number | null {
    return this.browserPageOwnerWindowById.get(pageId) ?? null
  }
  handleWindowScopesChanged(): void {
    this.rebuildOwnerWindowIndexes()
  }
  /** Drop one renderer's contribution after its native window closes. */
  releaseWindow(windowId: number): void {
    this.dropWindowGraphContribution(windowId)
  }

  /** Retire only leaves unique to a closed publisher; siblings remain live. */
  protected dropWindowGraphContribution(windowId: number): void {
    const publication = this.windowGraphPublications.get(windowId)
    this.windowGraphPublications.delete(windowId)
    for (const [ptyId, owner] of this.transientPtyOwnerWindowById) {
      if (owner === windowId) {
        this.transientPtyOwnerWindowById.delete(ptyId)
      }
    }
    for (const [ptyId, owner] of this.explicitPtyOwnerWindowById) {
      if (owner === windowId) {
        this.explicitPtyOwnerWindowById.delete(ptyId)
      }
    }
    if (!publication) {
      this.rebuildOwnerWindowIndexes()
      return
    }
    const survivingTabs = new Set<string>()
    const survivingLeaves = new Set<string>()
    for (const other of this.windowGraphPublications.values()) {
      other.tabIds.forEach((id) => survivingTabs.add(id))
      other.leafKeys.forEach((key) => survivingLeaves.add(key))
    }
    const retiredLeaves: RuntimeLeafRecord[] = []
    for (const leafKey of publication.leafKeys) {
      if (!survivingLeaves.has(leafKey)) {
        const leaf = this.leaves.get(leafKey)
        if (leaf) {
          retiredLeaves.push(leaf)
        }
      }
    }
    this.rememberDetachedPreAllocatedLeaves(retiredLeaves)
    for (const leaf of retiredLeaves) {
      const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
      this.invalidateLeafHandle(leafKey)
      this.leaves.delete(leafKey)
    }
    for (const tabId of publication.tabIds) {
      if (!survivingTabs.has(tabId)) {
        this.tabs.delete(tabId)
      }
    }
    this.rebuildLeafPtyIndex()
    this.rebuildOwnerWindowIndexes()
    this.refreshWritableFlags()
  }


}
