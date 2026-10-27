import { registerWindowOrphanSweep } from './delivery/window-orphan-sweep'
import { getMainWindowForWebContents } from '../../window/main-window-registry'
import { settledDaemonRestart } from '../../daemon/daemon-restart-state'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { Store } from '../../persistence'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TerminalStartupCwdMissingDirFallback } from '../../../shared/terminal-startup-cwd'
import {
  getHiddenRendererPtyDeliveryDebug,
  resetRendererScopedHiddenPtyDeliveryState
} from '../pty-hidden-delivery-gate'
import type { ResolvedPtyHost } from './provider/registry'
import { finishPtyShutdown } from './provider/liveness'
import type { GetSelectedCodexHomePath, PrepareClaudeAuth } from './host-env/types'
import { installPtyInspectIpcHandlers } from './ipc/inspect'
import { installPtyCodexSharedServerIpcHandler } from './ipc/codex-shared-server'
import { installPtyClaudeOldTerminalIpcHandler } from './ipc/claude-old-terminal'
import { installPtyClaudeDiffPanelNoticeIpcHandler } from './ipc/claude-diff-panel-notice'
import { installPtyNewerDaemonHoldIpcHandlers } from './ipc/newer-daemon-hold'
import {
  installPtyKillIpcHandler,
  stopReplacedPanePty,
  type PtyKillIpcDeps
} from './ipc/renderer-kill'
import { installPtyClaudeLiveSessionIpcHandler } from './ipc/claude-live-session'
import { installPtyWriteIpcHandlers } from './ipc/write'
import { installPtySpawnIpcHandler } from './ipc/spawn'
import { installPtyLeafMoveIpcHandler } from './ipc/leaf-move'
import { installPtyRuntimeController } from './runtime/controller'
import { installPtySnapshotIpcHandlers } from './ipc/snapshot'
import {
  assertWorkspaceAcceptsNewPty as assertWorkspaceAcceptsNewPtyImpl,
  localStartupCwdDirectoryExists,
  resolvePtySpawnStartupCwd as resolvePtySpawnStartupCwdImpl
} from './host-env/spawn-cwd'
import {
  setInvalidatePendingPtyDrainPolicy,
  setInvalidatePendingPtyDrainPriority,
  invalidatePendingPtyDrainPolicy
} from './delivery/visibility-state'
import {
  setRebindProviderListeners,
  setRendererGateResetState
} from './provider/listener-lifecycle'
import {
  resetRendererDeliveryAccountingForLifecycleReset,
  setResetRendererDeliveryAccountingForLifecycleReset,
  clearRendererDispatcherReadyWatchdog
} from './delivery/debug'
import {
  registerRendererLifecycleResetHandlers,
  clearRendererLifecycleResetHandlers,
  clearRendererGateResetHandlers
} from './delivery/lifecycle-reset'
import { createPtyIpcSession, type PtyIpcSessionOptions, type PtyRendererDelivery } from './session'
import { wirePtyIpcSession } from './delivery/wire-session'
import { configureLocalPtyProvider } from './provider/local-configure'
import { bindProviderListeners } from './provider/bind-listeners'
import { installPtySerializeBufferIpc } from './ipc/serialize-buffer'
import { installPtyWindowOwnershipIpc } from './delivery/owner-transfer'
import { installPtyResizeVisibilityIpc } from './ipc/resize-visibility'
import { installPtyAckCreditIpc } from './ipc/ack-credit'
import { adoptStablePane } from './pane/adopt-stable'
import { getPtyIpc } from '../pty-host-bindings'
import {
  noCodexResumeLaunch,
  prepareCodexResumeHome,
  reconcileSharedRuntimeResumeHome,
  resolveCodexResumeLaunch,
  stripSequencedStartupResumeArgv
} from './host-env/codex-resume'
import { ensureLinuxTerminalOrcaCliShimDir } from '../../cli/linux-terminal-orca-cli-shim'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'

export function registerPtyHandlers(
  mainWindow?: PtyRendererDelivery,
  runtime?: OrcaRuntimeService,
  getSelectedCodexHomePath?: GetSelectedCodexHomePath,
  getSettings?: () => GlobalSettings,
  prepareClaudeAuth?: PrepareClaudeAuth,
  store?: Store,
  options?: PtyIpcSessionOptions
): void {
  if (process.platform === 'linux') {
    const appEnvironment = getAppEnvironment()
    if (appEnvironment.isPackaged()) {
      ensureLinuxTerminalOrcaCliShimDir({ userDataPath: appEnvironment.getPath('userData') })
    }
  }
  const ipcMain = getPtyIpc()
  // Why first: the outgoing session owns the producer pauses, so its real reset must run
  // before the bridge is neutralized or a PTY paused during re-registration stays paused.
  resetRendererDeliveryAccountingForLifecycleReset()
  // Why: a re-registration means a new window owns delivery — cancel the prior closure's watchdog and neutralize its bridged reset so mark-hidden below can't arm a timer against the dead closure.
  clearRendererDispatcherReadyWatchdog()
  setResetRendererDeliveryAccountingForLifecycleReset(() => {})
  setInvalidatePendingPtyDrainPriority(() => {})
  setInvalidatePendingPtyDrainPolicy(() => {})
  // Why: neutralize rebind at the same moment as drain so a daemon replace in this window cannot attach the old accept/exit closures.
  setRebindProviderListeners(() => {})
  if (mainWindow && !options?.headless) {
    registerRendererLifecycleResetHandlers(mainWindow.webContents as Electron.WebContents)
  } else {
    clearRendererLifecycleResetHandlers()
  }

  // Why only `local`: the daemon swap re-owns this machine's PTYs; no other host waits on it.
  const getLocalPtyStartupPromise = (
    hostId: ResolvedPtyHost = LOCAL_EXECUTION_HOST_ID
  ): Promise<void> | undefined => {
    if (hostId !== LOCAL_EXECUTION_HOST_ID) {
      return undefined
    }
    // Why: during cold start the daemon provider swap overlaps first paint, so local spawns must wait; SSH/headless don't use the desktop daemon.
    const startup = options?.awaitLocalPtyStartup?.()
    // A pane replaced by a restart spawns while it runs; it must reach the new daemon, not the old.
    const restart = settledDaemonRestart()
    return startup && restart
      ? Promise.all([startup, restart]).then(() => undefined)
      : (startup ?? restart)
  }

  const getLocalPtyProviderStartupPromise = (
    hostId: ResolvedPtyHost = LOCAL_EXECUTION_HOST_ID
  ): Promise<void> | undefined => {
    if (hostId !== LOCAL_EXECUTION_HOST_ID) {
      return undefined
    }
    return options?.awaitLocalPtyProviderStartup?.() ?? options?.awaitLocalPtyStartup?.()
  }

  // Remove prior handlers so re-registration (e.g. macOS re-activate creating a new window) doesn't double-register.
  ipcMain.removeHandler('pty:spawn')
  ipcMain.removeHandler('pty:moveLeafToNewTab')
  ipcMain.removeHandler('pty:kill')
  ipcMain.removeHandler('pty:listSessions')
  ipcMain.removeHandler('pty:hasPty')
  ipcMain.removeHandler('pty:rehomeTabWorktree')
  ipcMain.removeHandler('pty:hasChildProcesses')
  ipcMain.removeHandler('pty:getForegroundProcess')
  ipcMain.removeHandler('pty:inspectProcess')
  ipcMain.removeHandler('pty:confirmForegroundProcess')
  ipcMain.removeHandler('pty:resolveClaudeSessionId')
  ipcMain.removeHandler('pty:isCodexOnSharedServer')
  ipcMain.removeHandler('pty:disableCodexSharedServerAutoStart')
  ipcMain.removeHandler('pty:stopCodexSharedServer')
  ipcMain.removeHandler('pty:openedBeforeClaudeAccounts')
  ipcMain.removeHandler('pty:claudeDiffPanelMayAutoOpen')
  ipcMain.removeHandler('pty:readNewerDaemonHeldScreen')
  ipcMain.removeHandler('pty:reopenNewerDaemonTerminals')
  ipcMain.removeHandler('pty:getCwd')
  ipcMain.removeHandler('pty:getSize')
  ipcMain.removeHandler('pty:getAuthoritativeBufferSnapshotCapabilities')
  ipcMain.removeHandler('pty:declarePendingPaneSerializer')
  ipcMain.removeHandler('pty:settlePaneSerializer')
  ipcMain.removeHandler('pty:clearPendingPaneSerializer')
  ipcMain.removeHandler('pty:reportRendererSerializerReady')
  ipcMain.removeHandler('pty:getMainBufferSnapshot')
  ipcMain.removeHandler('pty:sideEffectSnapshot')
  ipcMain.removeHandler('pty:getRendererDeliveryDebugSnapshot')
  ipcMain.removeHandler('pty:resetRendererDeliveryDebug')
  ipcMain.removeHandler('pty:reportRendererDeliveryState')
  ipcMain.removeHandler('pty:writeAccepted')
  ipcMain.handle(
    'pty:rehomeTabWorktree',
    async (_event, args: { tabId: string; worktreeId: string }) => {
      if (!args?.tabId || !args?.worktreeId) {
        return { rehomedPtyIds: [] }
      }
      return (
        runtime?.rehomeTerminalTabWorktree(args.tabId, args.worktreeId) ?? { rehomedPtyIds: [] }
      )
    }
  )
  ipcMain.removeAllListeners('pty:write')
  ipcMain.removeAllListeners('pty:ackColdRestore')
  ipcMain.removeAllListeners('pty:hiddenOutputRestoreApplied')
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.removeAllListeners('pty:deliveryResyncResponse')
  ipcMain.removeAllListeners('pty:serializeBuffer:response')

  const session = createPtyIpcSession({
    mainWindow,
    headless: options?.headless === true,
    runtime,
    store,
    getSettings,
    options
  })
  wirePtyIpcSession(session)
  configureLocalPtyProvider({
    runtime,
    getSettings,
    getSelectedCodexHomePath,
    trustedTerminalHandleEnv: session.trustedTerminalHandleEnv
  })
  bindProviderListeners(session)
  setRebindProviderListeners(() => bindProviderListeners(session))
  installPtySerializeBufferIpc(session)
  installPtyWindowOwnershipIpc(session)

  // Why: reload/crash orphans delivery-interest holds and hidden marks; reset so surviving PTYs aren't stuck force-fed or gated — each pane's first sync re-marks.
  clearRendererGateResetHandlers()
  const rendererWebContents = mainWindow?.webContents
  const resetRendererPtyDeliveryGateState = (): void => {
    const gateDebug = getHiddenRendererPtyDeliveryDebug()
    // Why scoped: this fires on one window's reload/crash; a global reset would drop the hidden
    // marks its siblings reported and force-feed PTYs no live pane is showing.
    resetRendererScopedHiddenPtyDeliveryState(
      mainWindow
        ? getMainWindowForWebContents(mainWindow.webContents as Electron.WebContents)?.id
        : undefined
    )
    if (gateDebug.hiddenDeliveryGatedPtyCount > 0 || gateDebug.deliveryInterestPtyCount > 0) {
      invalidatePendingPtyDrainPolicy()
    }
    // Why: the daemon pacer must not keep throttling ptys whose hidden marks died with the renderer; the fresh renderer's sync re-marks the still-hidden ones.
    session.resyncBackgroundedDeliveriesAfterGateReset()
  }
  if (rendererWebContents) {
    setRendererGateResetState({
      contents: rendererWebContents,
      load: resetRendererPtyDeliveryGateState,
      gone: resetRendererPtyDeliveryGateState
    })
  }
  rendererWebContents?.on('did-finish-load', resetRendererPtyDeliveryGateState)
  rendererWebContents?.on('render-process-gone', resetRendererPtyDeliveryGateState)

  registerWindowOrphanSweep({ mainWindow, runtime, options })

  const assertWorkspaceAcceptsNewPty = (
    worktreeId: string | undefined,
    sessionId?: string
  ): Promise<void> | void => assertWorkspaceAcceptsNewPtyImpl(store, worktreeId, sessionId)
  const resolvePtySpawnStartupCwd = (
    worktreeId: string | undefined,
    cwd: string | undefined,
    missingDirFallback?: TerminalStartupCwdMissingDirFallback
  ): string | undefined => resolvePtySpawnStartupCwdImpl(store, worktreeId, cwd, missingDirFallback)
  const prepareCodexResumeHomeBound = (
    args: Parameters<typeof prepareCodexResumeHome>[1]
  ): ReturnType<typeof prepareCodexResumeHome> =>
    prepareCodexResumeHome(options?.prepareCodexSessionResume, args)
  const adoptStablePaneBound = (args: Parameters<typeof adoptStablePane>[2]) =>
    adoptStablePane(runtime, store, args)

  // Why: route through getProviderForPty() so CLI commands work for remote PTYs too; localProvider would silently fail for them.
  installPtyRuntimeController({
    runtime,
    store,
    adoptStablePane: adoptStablePaneBound,
    getLocalPtyStartupPromise,
    getLocalPtyProviderStartupPromise,
    prepareCodexResumeHome: prepareCodexResumeHomeBound,
    resolveCodexResumeLaunch,
    noCodexResumeLaunch,
    reconcileSharedRuntimeResumeHome,
    stripSequencedStartupResumeArgv,
    assertWorkspaceAcceptsNewPty,
    resolvePtySpawnStartupCwd,
    requestSerializedBuffer: session.requestSerializedBuffer,
    shutdownProviderAndDetectExit: session.shutdownProviderAndDetectExit,
    rememberSyntheticKillExit: session.rememberSyntheticKillExit,
    rememberRetiredRejectedPty: session.rememberRetiredRejectedPty,
    sendPtyExitToRenderer: session.sendPtyExitToRenderer,
    sendPtySpawnedToRenderer: session.sendPtySpawnedToRenderer,
    finishPtyShutdown,
    getSettings,
    getSelectedCodexHomePath,
    prepareClaudeAuth,
    options,
    trustedTerminalHandleEnv: session.trustedTerminalHandleEnv,
    retiredRejectedPtyIds: session.retiredRejectedPtyIds,
    mainWindow,
    transitionSpawnHiddenRendererPtyDeliveryState:
      session.transitionSpawnHiddenRendererPtyDeliveryState,
    syncPtyBackgroundedDelivery: session.syncPtyBackgroundedDelivery
  })

  installPtySnapshotIpcHandlers({ runtime, pendingData: session.pendingData })
  const killDeps: PtyKillIpcDeps = {
    store,
    runtime,
    getLocalPtyProviderStartupPromise,
    shutdownProviderAndDetectExit: session.shutdownProviderAndDetectExit,
    rememberSyntheticKillExit: session.rememberSyntheticKillExit,
    sendPtyExitToRenderer: session.sendPtyExitToRenderer
  }
  installPtyLeafMoveIpcHandler({ store, runtime })
  installPtySpawnIpcHandler({
    runtime,
    store,
    getSettings,
    getSelectedCodexHomePath,
    prepareClaudeAuth,
    options,
    getLocalPtyStartupPromise,
    adoptStablePane: adoptStablePaneBound,
    assertWorkspaceAcceptsNewPty,
    resolvePtySpawnStartupCwd,
    localStartupCwdDirectoryExists,
    prepareCodexResumeHome: prepareCodexResumeHomeBound,
    noCodexResumeLaunch,
    resolveCodexResumeLaunch,
    reconcileSharedRuntimeResumeHome,
    stripSequencedStartupResumeArgv,
    transitionSpawnHiddenRendererPtyDeliveryState:
      session.transitionSpawnHiddenRendererPtyDeliveryState,
    trustedTerminalHandleEnv: session.trustedTerminalHandleEnv,
    sendPtySpawnedToRenderer: session.sendPtySpawnedToRenderer,
    syncPtyBackgroundedDelivery: session.syncPtyBackgroundedDelivery,
    stopReplacedPty: (id) => stopReplacedPanePty(killDeps, id)
  })
  installPtyWriteIpcHandlers({ mainWindow, runtime, headless: options?.headless })
  installPtyResizeVisibilityIpc(session)
  installPtyAckCreditIpc(session)
  installPtyInspectIpcHandlers({ getLocalPtyProviderStartupPromise })
  installPtyClaudeLiveSessionIpcHandler({
    getLocalPtyProviderStartupPromise: () => getLocalPtyProviderStartupPromise()
  })
  installPtyCodexSharedServerIpcHandler({ getLocalPtyProviderStartupPromise })
  installPtyClaudeOldTerminalIpcHandler({ getLocalPtyProviderStartupPromise })
  installPtyClaudeDiffPanelNoticeIpcHandler({ getLocalPtyProviderStartupPromise })
  installPtyNewerDaemonHoldIpcHandlers()
  installPtyKillIpcHandler(killDeps)
}
