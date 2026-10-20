import type { BrowserWindow } from 'electron'
import { agentHookServer } from '../agent-hooks/server'
import { setMigrationUnsupportedPtyListener } from '../agent-hooks/migration-unsupported-pty-state'
import { getDashboardPopoutWindow } from '../window/dashboard-popout-window'
import { stopSyntheticTitleSpinnerTimer } from './synthetic-title-runtime'
import { mainProcessState as state } from './main-process-state'
import { getFocusedOrLastActiveMainWindow, sendToWindow } from '../window/main-window-registry'
import { getPtyIdForPaneKey } from '../ipc/pty/pane/key-state'

export type MainWindowAgentStatusOptions = {
  window: BrowserWindow
  onRecordAgentState: (agentType: string, status: string) => void
}

const registeredWindows = new Set<BrowserWindow>()
let listenerOptions: MainWindowAgentStatusOptions | null = null

function liveWindows(): BrowserWindow[] {
  return [...registeredWindows].filter((window) => !window.isDestroyed())
}

function resolveOwnerWindow(ptyId?: string): BrowserWindow | null {
  const ownerId = ptyId ? state.runtime?.resolveOwnerWindowIdForPtyId(ptyId) : null
  const owner =
    ownerId === null || ownerId === undefined
      ? null
      : (liveWindows().find((window) => window.id === ownerId) ?? null)
  return owner ?? getFocusedOrLastActiveMainWindow() ?? state.mainWindow
}

function sendStatusToWindows(
  payload: Record<string, unknown>,
  paneKey: string,
  ptyId?: string
): void {
  const owner = resolveOwnerWindow(ptyId ?? getPtyIdForPaneKey(paneKey))
  for (const window of liveWindows()) {
    sendToWindow(window, 'agentStatus:set', {
      ...payload,
      ...(owner && window !== owner ? { presentationOnly: true as const } : {})
    })
  }
}

export function installMainWindowAgentStatusListeners(options: MainWindowAgentStatusOptions): void {
  registeredWindows.add(options.window)
  if (listenerOptions) {
    return
  }
  listenerOptions = options
  agentHookServer.setListener(
    ({
      paneKey,
      tabId,
      worktreeId,
      connectionId,
      payload,
      receivedAt,
      evidenceObservedAt,
      stateStartedAt,
      turnStartedAt,
      launchToken,
      providerSession,
      providerSessionOnly,
      promptInteractionKey,
      restoredUnconfirmed,
      observation,
      isReplay,
      authorityRestartId,
      structuredHost,
      programStatus,
      programStatusOnly
    }) => {
      if (liveWindows().length === 0) {
        return
      }
      // Why: the renderer still derives structured rows from its own feed subscription; forwarding
      // these too would give one pane key two writers until that bridge is retired.
      if (structuredHost) {
        return
      }
      if (providerSessionOnly) {
        // Why: session_start just refreshes durable resume identity while Pi is idle; forward it without titles, telemetry, or status UI.
        for (const window of liveWindows()) {
          sendToWindow(window, 'agentStatus:set', {
            ...payload,
            paneKey,
            ...(launchToken ? { launchToken } : {}),
            tabId,
            worktreeId,
            connectionId,
            receivedAt,
            ...(evidenceObservedAt !== undefined ? { evidenceObservedAt } : {}),
            stateStartedAt,
            ...(providerSession ? { providerSession } : {}),
            ...(observation ? { observation } : {}),
            ...(isReplay ? { isReplay: true as const } : {}),
            providerSessionOnly: true
          })
        }
        return
      }
      const runtime = state.runtime
      const orchestration = runtime?.getAgentStatusOrchestrationContextForPaneKey(paneKey)
      const terminalHandle = runtime?.getAgentStatusTerminalHandleForPaneKey(paneKey)
      const statusEvent = {
        ...(authorityRestartId && isReplay !== true ? { authorityRestartId } : {}),
        ...payload,
        paneKey,
        ...(launchToken ? { launchToken } : {}),
        ...(terminalHandle ? { terminalHandle } : {}),
        tabId,
        worktreeId,
        connectionId,
        receivedAt,
        ...(evidenceObservedAt !== undefined ? { evidenceObservedAt } : {}),
        stateStartedAt,
        ...(turnStartedAt !== undefined ? { turnStartedAt } : {}),
        ...(providerSession ? { providerSession } : {}),
        ...(promptInteractionKey ? { promptInteractionKey } : {}),
        ...(restoredUnconfirmed ? { restoredUnconfirmed: true } : {}),
        ...(observation ? { observation } : {}),
        ...(orchestration ? { orchestration } : {}),
        ...(programStatus ? { programStatus } : {}),
        ...(programStatusOnly === true ? { programStatusOnly: true } : {}),
        // Why: reconnect replays re-send cached rows; the renderer must not treat them as fresh completions.
        ...(isReplay === true ? { isReplay: true } : {})
      }
      sendStatusToWindows(statusEvent, paneKey)
      getDashboardPopoutWindow()?.webContents.send('agentStatus:set', statusEvent)
      // A facet-only republish (progress tick) is not a state the agent entered.
      if (programStatusOnly !== true) {
        listenerOptions?.onRecordAgentState(payload.agentType ?? 'unknown', payload.state)
      }
    }
  )
  agentHookServer.setPaneStatusClearListener((clear) => {
    if (liveWindows().length === 0) {
      return
    }
    for (const window of liveWindows()) {
      sendToWindow(window, 'agentStatus:clear', clear)
    }
    getDashboardPopoutWindow()?.webContents.send('agentStatus:clear', clear)
  })
  setMigrationUnsupportedPtyListener((event) => {
    if (liveWindows().length === 0) {
      return
    }
    if (event.type === 'set') {
      for (const window of liveWindows()) {
        sendToWindow(window, 'agentStatus:migrationUnsupported', event.entry)
      }
    } else {
      for (const window of liveWindows()) {
        sendToWindow(window, 'agentStatus:migrationUnsupportedClear', { ptyId: event.ptyId })
      }
    }
  })
}

export function clearMainWindowAgentStatusListeners(window?: BrowserWindow): void {
  if (window) {
    registeredWindows.delete(window)
  } else {
    registeredWindows.clear()
  }
  if (registeredWindows.size > 0) {
    return
  }
  agentHookServer.setListener(null)
  agentHookServer.setPaneStatusClearListener(null)
  setMigrationUnsupportedPtyListener(null)
  listenerOptions = null
  // Why timer only: it would fire into destroyed webContents, but the hook subscription has no
  // replay, so a reopened window resumes the kept working entries on 'show'.
  stopSyntheticTitleSpinnerTimer()
}
