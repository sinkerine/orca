import type { RuntimeLeafRecord } from '../runtime-terminal-state-records'
/* eslint-disable unicorn/no-useless-spread */
import { OrcaRuntimeWithAttachWindow } from './session-graph-promotion'
import type {
  RuntimeRendererSyncWindowGraph,
  RuntimeSyncWindowGraph,
  RuntimeSyncWindowGraphResult
} from '../../../shared/runtime-session-contracts'
import { HEADLESS_RUNTIME_WINDOW_ID } from '../../../shared/runtime-types'
import {
  assertUniqueRuntimeGraphTabIds,
  rebuildRuntimeWindowOwnershipIndex
} from '../runtime-window-ownership-index'

export abstract class OrcaRuntimeWithSyncWindowGraph extends OrcaRuntimeWithAttachWindow {
  declare protected terminalGroupGridSizes?: RuntimeSyncWindowGraph['terminalGroupGridSizes']
  declare protected singleGroupWorkspaceGridSize?: RuntimeSyncWindowGraph['singleGroupWorkspaceGridSize']

  // Why: a remounting pane publishes its leaf with no PTY until its transport reattaches the same
  // session. Dropping it re-minted the handle every paired client was typing into (#23759).
  private isLeafRemountingLivePty(
    ptyId: string,
    incomingPtyIds: ReadonlySet<string | null>
  ): boolean {
    return (
      !incomingPtyIds.has(ptyId) &&
      this.controllerKnowsPtyIsLive(ptyId) &&
      this.getPtyLivenessVerdict(ptyId)?.status !== 'exited'
    )
  }

  shouldRelayTerminalBrowserOpens(): boolean {
    return this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID
  }

  syncWindowGraph(
    windowId: number,
    graph: RuntimeSyncWindowGraph | RuntimeRendererSyncWindowGraph
  ): RuntimeSyncWindowGraphResult {
    // `tabs` and several downstream indexes are keyed only by tab id. Reject
    // malformed persisted/mirrored graphs before authority or graph state is
    // changed; choosing a winner would route PTYs to the wrong worktree.
    assertUniqueRuntimeGraphTabIds(graph.tabs)
    if (
      windowId !== HEADLESS_RUNTIME_WINDOW_ID &&
      this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID &&
      this.headlessGraphFallbackAvailable
    ) {
      if (windowId !== this.pendingHeadlessPromotionWindowId) {
        throw new Error('Runtime graph publisher does not match the pending desktop promotion')
      }
      // Why: a renderer may publish after a failed promotion was restored to
      // headless authority; accepting that late healthy graph is self-healing.
      this.attachWindow(windowId)
    }
    if (this.authoritativeWindowId === null) {
      this.authoritativeWindowId = windowId
    }
    // Only attached windows may publish; authoritativeWindowId owns reload/headless lifecycle.
    const isAuthoritativePublisher = windowId === this.authoritativeWindowId
    if (!isAuthoritativePublisher && !this.windowGraphPublications.has(windowId)) {
      throw new Error('Runtime graph publisher does not match the authoritative window')
    }
    const rendererGeneration =
      windowId === HEADLESS_RUNTIME_WINDOW_ID || !isAuthoritativePublisher
        ? null
        : 'rendererGeneration' in graph && typeof graph.rendererGeneration === 'string'
          ? graph.rendererGeneration
          : undefined
    if (
      typeof rendererGeneration === 'string' &&
      rendererGeneration === this.rendererGeneration &&
      this.graphStatus !== 'ready'
    ) {
      throw new Error('Runtime graph publisher belongs to a superseded renderer generation')
    }
    if (windowId === HEADLESS_RUNTIME_WINDOW_ID) {
      this.headlessGraphFallbackAvailable = true
      this.servesHeadlessGraph = true
      this.rendererGeneration = null
    }

    const previousPublication = this.windowGraphPublications.get(windowId)
    this.windowGraphPublications.set(windowId, {
      tabIds: new Set(graph.tabs.map((tab) => tab.tabId)),
      leafKeys: new Set(graph.leaves.map((leaf) => this.getLeafKey(leaf.tabId, leaf.leafId))),
      browserPageIds: new Set(
        graph.mobileSessionTabs === undefined
          ? (previousPublication?.browserPageIds ?? new Set())
          : (graph.mobileSessionTabs ?? []).flatMap((snapshot) =>
              snapshot.tabs.flatMap((tab) =>
                tab.type === 'browser' && tab.browserPageId ? [tab.browserPageId] : []
              )
            )
      )
    })
    // Preserve panes still published by another window.
    if ([...this.windowGraphPublications.keys()].some((id) => id !== windowId)) {
      const survivingTabs = new Set<string>()
      const survivingLeaves = new Set<string>()
      for (const [id, publication] of this.windowGraphPublications) {
        if (id === windowId) {
          continue
        }
        publication.tabIds.forEach((tabId) => survivingTabs.add(tabId))
        publication.leafKeys.forEach((key) => survivingLeaves.add(key))
      }
      const allTabs = new Map([...this.tabs].filter(([id]) => survivingTabs.has(id)))
      for (const tab of graph.tabs) {
        allTabs.set(tab.tabId, tab)
      }
      const allLeaves = new Map<string, RuntimeSyncWindowGraph['leaves'][number]>(
        [...this.leaves].filter(([key]) => survivingLeaves.has(key))
      )
      for (const leaf of graph.leaves) {
        allLeaves.set(this.getLeafKey(leaf.tabId, leaf.leafId), leaf)
      }
      graph = { ...graph, tabs: [...allTabs.values()], leaves: [...allLeaves.values()] }
    }

    if (graph.terminalGroupGridSizes) {
      // Merged, not replaced: a group in a worktree the window is not showing keeps its last size.
      this.terminalGroupGridSizes = {
        ...this.terminalGroupGridSizes,
        ...graph.terminalGroupGridSizes
      }
    }
    if (graph.singleGroupWorkspaceGridSize) {
      this.singleGroupWorkspaceGridSize = graph.singleGroupWorkspaceGridSize
    }
    this.activeGroupViewFacts.merge(graph.activeGroupByWorkspace)
    const graphWasReady = this.graphStatus === 'ready'
    const previousTabs = this.tabs
    const previousLeaves = this.leaves
    this.tabs = new Map(graph.tabs.map((tab) => [tab.tabId, tab]))
    const lifecycleLeaves = this.reconcileMobileSessionRetirementFences(graph.leaves)
    const mobileSessionResyncWorktrees = new Set<string>()
    const changedMobileWorktrees = this.syncMobileSessionTabs(
      graph.mobileSessionTabs,
      graph.unchangedMobileSessionWorktrees,
      mobileSessionResyncWorktrees,
      rendererGeneration
    )
    const graphSyncedAt = this.nextTitleObservationSequence()
    const nextLeaves = new Map<string, RuntimeLeafRecord>()
    // Bumped before the leaf loop so surfaces this statement records are stamped with it, and a
    // surface recorded after it is immune until the next one (pty-recorded-surface-topology.ts).
    // The headless placeholder is exempt: it is published once at launch so status clients see a
    // ready server, names no renderer pane, and is never replaced. Counting it as a statement left
    // every claim written without standing — a persisted replay, an inventory restore, a TUI-owner
    // recovery — permanently orphaned on a headless host, with no graph that could ever re-stamp
    // it (#18191).
    if (windowId !== HEADLESS_RUNTIME_WINDOW_ID) {
      this.graphSequence += 1
    }

    // Why: renderer reloads can briefly republish the same leaf with no ptyId;
    // keep live CLI handles usable while the UI graph rebuilds.
    const preserveLivePtysDuringReload = this.graphStatus === 'reloading'
    const incomingPtyIds = new Set(lifecycleLeaves.map((leaf) => leaf.ptyId).filter(Boolean))
    for (const leaf of lifecycleLeaves) {
      if (leaf.ptyId) {
        if (leaf.parked) {
          this.orchestrationMailboxPointerDelivery.markPtyColdParked(leaf.ptyId)
        } else {
          this.orchestrationMailboxPointerDelivery.clearPtyColdParked(leaf.ptyId)
        }
      }
      const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
      const existing = this.leaves.get(leafKey)
      const ptyId =
        leaf.ptyId === null &&
        existing?.ptyId &&
        (preserveLivePtysDuringReload ||
          this.isLeafRemountingLivePty(existing.ptyId, incomingPtyIds))
          ? existing.ptyId
          : leaf.ptyId
      const ptyGeneration =
        existing && existing.ptyId !== ptyId
          ? existing.ptyGeneration + 1
          : (existing?.ptyGeneration ?? 0)
      const existingPty = ptyId ? this.ptysById.get(ptyId) : undefined
      // Retained history stays addressable, but a renderer graph cannot revoke a host-certified exit.
      const connected = ptyId !== null && this.getPtyLivenessVerdict(ptyId)?.status !== 'exited'
      const tailSource = existing?.ptyId === ptyId ? existing : existingPty

      nextLeaves.set(leafKey, {
        ...leaf,
        ptyId,
        ptyGeneration,
        connected,
        writable: this.graphStatus === 'ready' && connected,
        lastOutputAt: tailSource?.lastOutputAt ?? null,
        lastExitCode: tailSource?.lastExitCode ?? null,
        lastExitCause: tailSource?.lastExitCause ?? null,
        tailBuffer: tailSource?.tailBuffer ?? [],
        tailTranscriptBuffer: tailSource?.tailTranscriptBuffer ?? [],
        tailTranscriptChars: tailSource?.tailTranscriptChars ?? 0,
        tailPartialLine: tailSource?.tailPartialLine ?? '',
        tailPendingAnsi: tailSource?.tailPendingAnsi ?? '',
        tailRedrawCursor: tailSource?.tailRedrawCursor ?? null,
        tailTruncated: tailSource?.tailTruncated ?? false,
        tailLinesTotal: tailSource?.tailLinesTotal ?? 0,
        preview: tailSource?.preview ?? '',
        waitBlockedAt: tailSource?.waitBlockedAt ?? null,
        lastAgentStatus: tailSource?.lastAgentStatus ?? null,
        lastAgentStatusObservedLive: tailSource?.lastAgentStatusObservedLive ?? false,
        lastOscTitle: tailSource?.lastOscTitle ?? null,
        lastOscTitleAt: tailSource?.lastOscTitleAt ?? null,
        paneTitleUpdatedAt:
          existing?.ptyId === ptyId && existing.paneTitle === leaf.paneTitle
            ? existing.paneTitleUpdatedAt
            : graphSyncedAt
      })

      if (leaf.ptyId && connected) {
        this.recordPtyWorktree(leaf.ptyId, leaf.worktreeId, {
          connected: true,
          lastOutputAt: existing?.ptyId === leaf.ptyId ? existing.lastOutputAt : null,
          preview: existing?.ptyId === leaf.ptyId ? existing.preview : '',
          tabId: leaf.tabId,
          paneKey: this.makeRuntimePaneKey(leaf),
          surfaceRecordedAtGraphSequence: this.graphSequence
        })
      }

      if (existing && (existing.ptyId !== ptyId || existing.ptyGeneration !== ptyGeneration)) {
        // Why: mobile can subscribe while the pane is waiting for its first PTY.
        // Keep that handle usable after the recovery mount binds it.
        const adoptedFirstPty =
          existing.ptyId === null && this.adoptFirstPtyForLeafHandle(leafKey, ptyId, ptyGeneration)
        if (!adoptedFirstPty) {
          this.invalidateLeafHandle(leafKey)
        }
      }
    }

    const nextPtyIds = new Set([...nextLeaves.values()].map((leaf) => leaf.ptyId).filter(Boolean))
    for (const [oldLeafKey, oldLeaf] of previousLeaves) {
      if (nextLeaves.has(oldLeafKey)) {
        continue
      }
      if (oldLeaf.ptyId && !nextPtyIds.has(oldLeaf.ptyId)) {
        this.orchestrationMailboxPointerDelivery.markPtyColdParked(oldLeaf.ptyId)
      }
      const retainedIncarnation = oldLeaf.ptyId
        ? this.handleByPtyIncarnation.get(oldLeaf.ptyId)
        : undefined
      if (
        preserveLivePtysDuringReload &&
        oldLeaf.ptyId &&
        (this.handleByPtyId.has(oldLeaf.ptyId) ||
          (retainedIncarnation &&
            retainedIncarnation.incarnationId ===
              this.ptysById.get(oldLeaf.ptyId)?.incarnationId)) &&
        !nextPtyIds.has(oldLeaf.ptyId)
      ) {
        nextLeaves.set(oldLeafKey, oldLeaf)
        nextPtyIds.add(oldLeaf.ptyId)
      } else if (oldLeaf.ptyId && nextPtyIds.has(oldLeaf.ptyId)) {
        const oldHandle = this.handleByLeafKey.get(oldLeafKey)
        if (
          oldHandle !== undefined &&
          (oldHandle === this.handleByPtyId.get(oldLeaf.ptyId) ||
            oldHandle === retainedIncarnation?.handle)
        ) {
          this.handleByLeafKey.delete(oldLeafKey)
        } else {
          this.invalidateLeafHandle(oldLeafKey)
        }
      } else {
        this.invalidateLeafHandle(oldLeafKey)
      }
    }
    for (const [ptyId, leaf] of this.detachedPreAllocatedLeaves) {
      if (nextPtyIds.has(ptyId) || !this.handleByPtyId.has(ptyId)) {
        this.detachedPreAllocatedLeaves.delete(ptyId)
        continue
      }
      nextLeaves.set(this.getLeafKey(leaf.tabId, leaf.leafId), leaf)
      nextPtyIds.add(ptyId)
    }

    this.leaves = nextLeaves
    this.rebuildLeafPtyIndex()
    this.rebuildOwnerWindowIndexes()
    this.reconcilePtyIncarnationHandles()
    // Why: the emitted client payload is a function of the stored snapshot AND
    // the tab/leaf graph (handles/titles/connected resolve from leaf state), so
    // a graph-only change — e.g. a restored leaf binding its ptyId while the
    // snapshot pair is unchanged — must also fan out, or a paired client stays
    // on pending-handle forever. Schedule the union on the same 50ms trailing
    // edge as the OSC-title path; the coalescer emit reads the latest state at
    // fire time so no final version is ever lost.
    for (const worktreeId of this.collectMobileVisibleGraphChangedWorktrees(
      previousTabs,
      previousLeaves
    )) {
      if (changedMobileWorktrees.has(worktreeId)) {
        continue
      }
      const stored = this.mobileSessionTabsByWorktree.get(worktreeId)
      if (!stored) {
        continue
      }
      // Graph-only changes need a fresh version so paired clients accept the re-emission.
      this.storeMobileSessionSnapshot(worktreeId, {
        ...stored,
        snapshotVersion: stored.snapshotVersion + 1
      })
      changedMobileWorktrees.add(worktreeId)
    }
    for (const worktreeId of changedMobileWorktrees) {
      if (this.mobileSessionTabsByWorktree.has(worktreeId)) {
        this.scheduleMobileSessionTabsChanged(worktreeId)
      }
    }
    const isAuthoritativeGraphPublisher = windowId === this.authoritativeWindowId
    this.markGraphReady(windowId)
    if (
      isAuthoritativeGraphPublisher &&
      (windowId === HEADLESS_RUNTIME_WINDOW_ID || graph.mobileSessionTabs !== undefined)
    ) {
      if (mobileSessionResyncWorktrees.size === 0) {
        this.markSessionTabsInventoryPublished()
      } else {
        this.sessionTabsInventoryPublicationEpoch = null
      }
    }
    if (rendererGeneration !== undefined) {
      this.rendererGeneration = rendererGeneration
    }
    for (const leaf of this.leaves.values()) {
      this.adoptPreAllocatedHandle(leaf)
      const previousLeaf = previousLeaves.get(this.getLeafKey(leaf.tabId, leaf.leafId))
      if (
        this._orchestrationDb &&
        leaf.lastAgentStatus === 'idle' &&
        leaf.lastAgentStatusObservedLive &&
        this.checkDeliverySettledAndArmRecheck(leaf) &&
        leaf.writable &&
        (!graphWasReady ||
          previousLeaf?.ptyId !== leaf.ptyId ||
          !previousLeaf.writable ||
          previousLeaf.lastAgentStatus !== 'idle' ||
          !previousLeaf.lastAgentStatusObservedLive)
      ) {
        this.deliverPendingMessagesForLeaf(leaf)
      }
    }

    // Why: createTerminal waits for the renderer's graph sync to populate the
    // new leaf so it can return a handle. Drain callbacks after leaves update.
    for (const cb of [...this.graphSyncCallbacks]) {
      cb()
    }

    const agentOrchestrationByPaneKey = this.agentOrchestrationProjection.buildByPaneKey()
    const nativeChatLaunchDraftResolutions =
      this.getNativeChatLaunchDraftResolutionClientEventSnapshot().map(
        ({ tabId, text, createdAt }) => ({ tabId, text, createdAt })
      )
    return {
      ...this.getStatus(),
      ...(agentOrchestrationByPaneKey ? { agentOrchestrationByPaneKey } : {}),
      ...(nativeChatLaunchDraftResolutions.length > 0 ? { nativeChatLaunchDraftResolutions } : {}),
      ...(mobileSessionResyncWorktrees.size > 0
        ? { mobileSessionResyncWorktrees: [...mobileSessionResyncWorktrees] }
        : {})
    }
  }

  protected rebuildOwnerWindowIndexes(): void {
    const indexes = rebuildRuntimeWindowOwnershipIndex({
      publications: this.windowGraphPublications,
      explicitClaims: this.explicitPtyOwnerWindowById,
      transientClaims: this.transientPtyOwnerWindowById,
      suppressedPtyIds: this.suppressedPtyOwnerWindowIds,
      previousPtyOwners: this.ptyOwnerWindowById,
      tabs: this.tabs,
      leaves: this.leaves,
      store: this.store,
      resolveWindowProjectGroupId: this.resolveWindowProjectGroupIdFn ?? (() => null)
    })
    for (const ptyId of indexes.consumedTransientPtyIds) {
      this.transientPtyOwnerWindowById.delete(ptyId)
    }
    this.tabOwnerWindowById = indexes.tabOwners
    this.tabOwnerWindowByWorktreeAndTabId = indexes.tabOwnersByWorktree
    this.leafOwnerWindowByKey = indexes.leafOwners
    this.ptyOwnerWindowById = indexes.ptyOwners
    this.browserPageOwnerWindowById = indexes.browserPageOwners
    // Restore routing resolves through these indexes, so publish only after they are current.
    if (indexes.ptyOwnerChanges.length > 0) {
      this.onPtyOwnerWindowsChanged?.(indexes.ptyOwnerChanges)
    }
  }
}
