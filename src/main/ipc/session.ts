import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Store } from '../persistence'
import type { WindowScope } from '../../shared/window-scope'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { parseTerminalSurfaceCloseTarget } from '../../shared/terminal-surface-close-target'
import { isFrozenOrcadSourceSessionPartition } from '../ssh/orcad-retained-source'
import { markAgentLaunchesClosedByUser } from '../agent-launch/agent-launch-pane-attachment'
import { windowViewPatchForMain, windowViewSaveForMain } from '../persistence/window-save-view'
import { reportWindowSaveDrift } from '../persistence/window-save-divergence'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session-state-types'
import { partitionWorkspaceSessionByWorktrees } from '../../shared/workspace-session-window-rebase'
import { resolveWindowScopeForWebContents } from '../window/window-view-state-registry'
import { ownedSessionKeysForWindow } from '../window/window-session-ownership'
import { withProjectWindowFocus } from '../window/project-window-session-focus'
import { closeTerminalTabInWorkspaceSession } from '../../shared/workspace-session-terminal-tab-close'
import { advanceTerminalTopologyRevision } from '../persistence/terminal-topology/terminal-topology-membership'

function resolveSenderWindowScope(
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined
): WindowScope | null {
  const senderId = event?.sender?.id
  return typeof senderId === 'number' ? resolveWindowScopeForWebContents(senderId) : null
}

/**
 * The worktrees the sending window owns, resolved from its scope. A free window owns everything
 * no project window is serving, which is what makes a project "move" out of the window it was
 * opened from; with no project windows up that is the whole session, exactly as before.
 */
function ownedSessionKeysForSender(
  store: Store,
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined,
  session: WorkspaceSessionState
): ReadonlySet<string> {
  return ownedSessionKeysForWindow(store, event?.sender?.id, session)
}

export function registerSessionHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  // Why: renderer saves would change a fenced host's frozen source partition.
  const isFenced = (hostId?: string | null): boolean =>
    isFrozenOrcadSourceSessionPartition(store, hostId)

  // Why: hostId is an optional second arg so an older renderer that invokes
  // these channels without it keeps reading/writing the 'local' partition
  // exactly as before. Channel names stay stable.
  // Why main projects instead of the renderer: a project window must see its own worktrees and
  // the shared window everything else, and only main knows the scope at first paint.
  ipcMain.handle('session:get', (event, hostId?: string | null) => {
    const session = store.getWorkspaceSession(hostId)
    const owned = ownedSessionKeysForSender(store, event, session)
    // Why one branch for both window kinds: `owned` already means "the keys this window serves",
    // so a project window gets its group and the free window gets everything else.
    if (owned.size === 0) {
      return session
    }
    const read = partitionWorkspaceSessionByWorktrees(session, owned).owned
    return resolveSenderWindowScope(event) ? withProjectWindowFocus(read, owned) : read
  })

  // Why a census channel: boot used to infer which partitions exist from the repo catalog, which
  // cannot name an SSH target whose only workspace is a folder — the runtime wrote that partition
  // and no reader ever enumerated it (#12723).
  ipcMain.handle('session:list-host-ids', () => {
    return store.getWorkspaceSessionHostIds()
  })

  // Switch point: main keeps its own layout over the window's and takes the window's view and
  // facts; the drift check reports where the save's layout still differs from main's.
  const sessionForMain = (args: WorkspaceSessionState, hostId: string | null | undefined) => {
    const stored = store.getWorkspaceSession(hostId)
    reportWindowSaveDrift(stored, args, hostId, 'session:set')
    return windowViewSaveForMain(stored, args, hostId, (session, partition) =>
      runtime!.shutdownReconnectFactsFor(session, partition)
    )
  }
  const patchForMain = (args: WorkspaceSessionPatch, hostId: string | null | undefined) => {
    const stored = store.getWorkspaceSession(hostId)
    reportWindowSaveDrift(stored, { ...stored, ...args }, hostId, 'session:patch')
    return windowViewPatchForMain(stored, args, hostId, (session, partition) =>
      runtime!.shutdownReconnectFactsFor(session, partition)
    )
  }

  ipcMain.handle('session:set', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    if (!isFenced(hostId)) {
      store.setWorkspaceSession(
        ORCA_LAYOUT_OWNER_IS_MAIN ? sessionForMain(args, hostId) : args,
        hostId,
        ownedSessionKeysForSender(store, event, store.getWorkspaceSession(hostId))
      )
    }
  })

  ipcMain.handle('session:patch', (event, args: WorkspaceSessionPatch, hostId?: string | null) => {
    if (!isFenced(hostId)) {
      store.patchWorkspaceSession(
        ORCA_LAYOUT_OWNER_IS_MAIN ? patchForMain(args, hostId) : args,
        hostId,
        ownedSessionKeysForSender(store, event, store.getWorkspaceSession(hostId))
      )
    }
  })

  // Why: a renderer save cannot shrink membership main owns, so each close commits it explicitly.
  ipcMain.handle(
    'session:close-terminal-surface',
    (_event, args: { worktreeId?: unknown; target?: unknown; reason?: unknown } | undefined) => {
      const target = parseTerminalSurfaceCloseTarget(args?.target)
      if (typeof args?.worktreeId !== 'string' || !target) {
        throw new Error('invalid_terminal_surface')
      }
      // Why only these two: main alone closes a tab for its process exit.
      const reason = args.reason === 'cleanup' ? 'cleanup' : 'user'
      if (reason === 'user') {
        // A launch still starting or delivering in what the user closed stops, and says so.
        markAgentLaunchesClosedByUser(args.worktreeId, target)
      }
      return runtime!.closeTerminalSurfaceFromRenderer({
        worktreeId: args.worktreeId,
        target,
        reason
      })
    }
  )

  ipcMain.handle('session:flush', () => {
    // Why: durable lifecycle RPCs must propagate disk failures instead of
    // returning success through Store.flush(), which intentionally only logs.
    return store.flushPendingOrThrowAsync()
  })

  ipcMain.handle(
    'session:closeTerminalTab',
    (
      event,
      args: { worktreeId?: unknown; tabId?: unknown; confirmed?: unknown },
      hostId?: string | null
    ): { closed: boolean; pinned: boolean } => {
      if (typeof args?.worktreeId !== 'string' || typeof args?.tabId !== 'string') {
        throw new Error('invalid_terminal_tab_close')
      }
      const session = store.getWorkspaceSession(hostId)
      const owned = ownedSessionKeysForSender(store, event, session)
      if (owned.size > 0 && !owned.has(args.worktreeId)) {
        throw new Error('worktree_not_owned')
      }
      const result = closeTerminalTabInWorkspaceSession(session, args.worktreeId, args.tabId)
      if (result.pinned) {
        if (args.confirmed !== true) {
          return { closed: false, pinned: true }
        }
        // Renderer pin confirmation is the user authorization; preserve the host-side guard for all other callers.
        const unpinnedSession = {
          ...session,
          tabsByWorktree: {
            ...session.tabsByWorktree,
            [args.worktreeId]: (session.tabsByWorktree[args.worktreeId] ?? []).map((tab) =>
              tab.id === args.tabId ? { ...tab, isPinned: false } : tab
            )
          },
          unifiedTabs: {
            ...session.unifiedTabs,
            [args.worktreeId]: (session.unifiedTabs?.[args.worktreeId] ?? []).map((tab) =>
              tab.id === args.tabId || tab.entityId === args.tabId
                ? { ...tab, isPinned: false }
                : tab
            )
          }
        }
        const confirmedResult = closeTerminalTabInWorkspaceSession(
          unpinnedSession,
          args.worktreeId,
          args.tabId
        )
        if (!confirmedResult.closed) {
          return { closed: false, pinned: true }
        }
        store.setWorkspaceSession(
          advanceTerminalTopologyRevision(confirmedResult.session, args.worktreeId),
          hostId,
          owned
        )
        try {
          store.flushOrThrow()
        } catch (error) {
          store.setWorkspaceSession(session, hostId, owned)
          throw error
        }
        return { closed: true, pinned: false }
      }
      if (!result.closed) {
        return { closed: false, pinned: false }
      }
      if (!store.setWorkspaceSession || !store.flushOrThrow) {
        throw new Error('workspace_session_unavailable')
      }
      store.setWorkspaceSession(
        advanceTerminalTopologyRevision(result.session, args.worktreeId),
        hostId,
        owned
      )
      try {
        store.flushOrThrow()
      } catch (error) {
        store.setWorkspaceSession(session, hostId, owned)
        throw error
      }
      return { closed: true, pinned: false }
    }
  )

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on('session:set-sync', (event, args: WorkspaceSessionState, hostId?: string | null) => {
    store.setWorkspaceSession(args, hostId, ownedSessionKeysForSender(store, event, args))
    store.flush()
    event.returnValue = true
  })

  ipcMain.on(
    'session:read-terminal-scrollback-sync',
    (event, args: { ref?: unknown } | undefined) => {
      event.returnValue =
        typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshot(args.ref) : null
    }
  )
}
