import type { PersistedState } from '../../../shared/persisted-state-types'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../../shared/workspace-session-state-types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import { pruneWorkspaceSessionBrowserHistory } from '../../../shared/workspace-session-browser-history'
import {
  rebaseWorkspaceSessionWrite,
  type OwnedWorktreeIds
} from '../../../shared/workspace-session-window-rebase'

import { workspaceSessionPatchNeedsFullNormalization } from './terminal-session-cleanup'

import { setLocalWorkspaceSession } from './workspace-session-snapshot-publication'
import type { StoreRuntimeState } from './store-runtime-state'
import type { SessionHostPartitionOperations } from './session-host-partitions'
import type { TerminalBindingRecoveryOperations } from './terminal-binding-recovery'
import type { WriteSchedulingOperations } from './write-scheduling'
import {
  resolveHostId,
  setHostWorkspaceSession,
  withRequiredWorkspaceSessionMaps
} from './session-host-partitions'
import { dropClosedTerminalTabs } from '../closed-terminal-tab-write-fence'
import { keepWslMoveFrozenSessionsForStore } from '../moving-wsl-projects/wsl-move-session-freeze'
import { scheduleSave } from './write-scheduling'
import { orderTerminalRowsByTabGroups } from '../../../shared/workspace-layout/terminal-row-order'

type SessionSnapshotOperationsRuntime = Pick<
  StoreRuntimeState,
  | 'durableMutationPhase'
  | 'pendingSnapshotFileWork'
  | 'profileMaintenancePending'
  | 'quitFlushStarted'
  | 'state'
  | 'terminalScrollbackSnapshotStorage'
  | 'retainedScrollbackRefsByMigrationId'
  | 'writesFrozen'
>

const sessionSnapshotOperationsContext = Symbol('SessionSnapshotOperations')
type SessionSnapshotOperationsContext = {
  runtime: SessionSnapshotOperationsRuntime
  sessions: SessionHostPartitionOperations
  bindingRecovery: TerminalBindingRecoveryOperations
  scheduling: WriteSchedulingOperations
}

export class SessionSnapshotOperations {
  readonly [sessionSnapshotOperationsContext]: SessionSnapshotOperationsContext

  constructor(
    runtime: SessionSnapshotOperationsRuntime,
    sessions: SessionHostPartitionOperations,
    bindingRecovery: TerminalBindingRecoveryOperations,
    scheduling: WriteSchedulingOperations
  ) {
    this[sessionSnapshotOperationsContext] = { runtime, sessions, bindingRecovery, scheduling }
  }

  /** A window that declares owned worktrees writes only their keys; everything else is preserved. */
  private rebaseForWindow(
    session: PersistedState['workspaceSession'],
    resolvedHostId: string,
    owned: OwnedWorktreeIds | undefined
  ): PersistedState['workspaceSession'] {
    if (!owned || owned.size === 0) {
      return session
    }
    const current =
      this[sessionSnapshotOperationsContext].sessions.getWorkspaceSession(resolvedHostId)
    return rebaseWorkspaceSessionWrite(current, session, owned)
  }

  setWorkspaceSession(
    session: PersistedState['workspaceSession'],
    hostId?: string | null,
    owned?: OwnedWorktreeIds
  ): void {
    const resolved = resolveHostId(hostId)
    const { runtime } = this[sessionSnapshotOperationsContext]
    if (runtime.durableMutationPhase === 'rollback') {
      this.assertSnapshotAdmission(true)
      // The fieldwise rollback already preserves newer edits; renderer rebasing would undo it.
      this.publishSession(
        resolved === LOCAL_EXECUTION_HOST_ID
          ? keepWslMoveFrozenSessionsForStore(session, runtime.state.workspaceSession)
          : session,
        resolved
      )
      return
    }
    const next = this.rebaseForWindow(session, resolved, owned)
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      this.assertSnapshotAdmission(true)
      setLocalWorkspaceSession(this, next)
      return
    }
    setHostWorkspaceSession(this[sessionSnapshotOperationsContext].sessions, resolved, next)
  }

  stageWorkspaceSessionBeforeUnload(
    session: PersistedState['workspaceSession'],
    hostId?: string | null
  ): void {
    const resolved = resolveHostId(hostId)
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      this.assertSnapshotAdmission()
      setLocalWorkspaceSession(this, session, true)
      return
    }
    setHostWorkspaceSession(this[sessionSnapshotOperationsContext].sessions, resolved, session)
  }

  patchWorkspaceSession(
    patch: WorkspaceSessionPatch,
    hostId?: string | null,
    owned?: OwnedWorktreeIds
  ): void {
    const resolved = resolveHostId(hostId)
    const current = this[sessionSnapshotOperationsContext].sessions.getWorkspaceSession(resolved)
    // Why: the debounced hot path sends only changed slices; scalar/UI patches skip terminal normalization, topology patches keep stale-PTY protections.
    const merged: WorkspaceSessionState = { ...current, ...patch }
    // Why rebase after the spread: a patch replaces the whole field, so a scoped window's
    // partial map would drop every other window's keys without this.
    let next: WorkspaceSessionState =
      owned && owned.size > 0 ? rebaseWorkspaceSessionWrite(current, merged, owned) : merged
    if (workspaceSessionPatchNeedsFullNormalization(patch)) {
      this.setWorkspaceSession(next, resolved)
      return
    }
    if (Object.hasOwn(patch, 'browserUrlHistory')) {
      next = pruneWorkspaceSessionBrowserHistory(next)
    }
    // Why: a unified-tabs patch skips full normalization, so it would bypass the close fence.
    if (Object.hasOwn(patch, 'unifiedTabs')) {
      next = dropClosedTerminalTabs(next)
    }
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      const { state } = this[sessionSnapshotOperationsContext].runtime
      next = keepWslMoveFrozenSessionsForStore(next, state.workspaceSession)
    }
    this.publishSession(next, resolved)
  }

  private publishSession(session: WorkspaceSessionState, hostId: ExecutionHostId): void {
    session = orderTerminalRowsByTabGroups(session)
    const { runtime, scheduling } = this[sessionSnapshotOperationsContext]
    if (hostId === LOCAL_EXECUTION_HOST_ID) {
      runtime.state.workspaceSession = session
    } else {
      runtime.state.workspaceSessionsByHostId = {
        ...runtime.state.workspaceSessionsByHostId,
        [hostId]: withRequiredWorkspaceSessionMaps(session)
      }
    }
    scheduleSave(
      scheduling,
      hostId === LOCAL_EXECUTION_HOST_ID ? ['workspaceSession'] : ['workspaceSessionsByHostId'],
      hostId
    )
  }

  private assertSnapshotAdmission(allowAdmittedMutation = false): void {
    const { runtime } = this[sessionSnapshotOperationsContext]
    if (
      runtime.writesFrozen ||
      ((runtime.profileMaintenancePending || runtime.quitFlushStarted) &&
        !(allowAdmittedMutation && runtime.durableMutationPhase !== null))
    ) {
      throw new Error('Profile maintenance or finalization is blocking new terminal snapshot work')
    }
  }
}

export function getSessionSnapshotOperationsContext(owner: SessionSnapshotOperations) {
  return owner[sessionSnapshotOperationsContext]
}
