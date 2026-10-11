import { useAppStore } from '../../store'
import type { AppState } from '../../store/types'
import { getAgentForkArgv, isForkableTuiAgent } from '../../../../shared/agent-session-fork'
import type { ForkableTuiAgent } from '../../../../shared/agent-session-fork'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
import { resolvePrimaryLayoutPtyId } from '@/store/terminals/terminal-pty-identities'
import type { AgentSessionForkSource } from '@/lib/agent-session-fork-startup-plan'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type ForkableAgentSession = AgentSessionForkSource & { agent: ForkableTuiAgent }

type ForkableAgentSessionState = Pick<
  AppState,
  | 'agentStatusByPaneKey'
  | 'sleepingAgentSessionsByPaneKey'
  | 'terminalLayoutsByTabId'
  | 'getAgentLaunchConfigForStatusEntry'
>

function focusedPaneFirst(paneKeys: string[], focusedPaneKey: string | null): string[] {
  return focusedPaneKey && paneKeys.includes(focusedPaneKey)
    ? [focusedPaneKey, ...paneKeys.filter((paneKey) => paneKey !== focusedPaneKey)]
    : paneKeys
}

/**
 * The provider session a tab's detected agent can branch from. Identity comes
 * from `tabAgent` (live hook/process status) and never from a launch command,
 * so aliased and wrapped launches fork the agent that is actually running.
 */
export function resolveForkableAgentSession(
  state: ForkableAgentSessionState,
  tab: Pick<TerminalTab, 'id'>,
  tabAgent: TuiAgent | null
): ForkableAgentSession | null {
  if (!isForkableTuiAgent(tabAgent)) {
    return null
  }
  const panePrefix = `${tab.id}:`
  const activeLeafId = state.terminalLayoutsByTabId[tab.id]?.activeLeafId
  const focusedPaneKey =
    activeLeafId && isTerminalLeafId(activeLeafId) ? makePaneKey(tab.id, activeLeafId) : null
  const ownPaneKeys = (record: Record<string, unknown>): string[] =>
    focusedPaneFirst(
      Object.keys(record).filter((paneKey) => paneKey.startsWith(panePrefix)),
      focusedPaneKey
    )

  for (const paneKey of ownPaneKeys(state.agentStatusByPaneKey)) {
    const status = state.agentStatusByPaneKey[paneKey]
    if (
      status.agentType === tabAgent &&
      status.providerSession &&
      getAgentForkArgv(tabAgent, status.providerSession)
    ) {
      const launchConfig = state.getAgentLaunchConfigForStatusEntry(status)
      return {
        agent: tabAgent,
        providerSession: status.providerSession,
        ...(launchConfig ? { launchConfig } : {})
      }
    }
  }
  // Restarted tabs may have restored provider identity before their first hook event.
  for (const paneKey of ownPaneKeys(state.sleepingAgentSessionsByPaneKey)) {
    const record = state.sleepingAgentSessionsByPaneKey[paneKey]
    if (record.agent === tabAgent && getAgentForkArgv(tabAgent, record.providerSession)) {
      return {
        agent: tabAgent,
        providerSession: record.providerSession,
        ...(record.launchConfig ? { launchConfig: record.launchConfig } : {})
      }
    }
  }
  return null
}

/**
 * PTY whose live Claude process can name its own session. Why: Claude reports a session to Orca
 * only through hooks, which cannot be installed when settings.json is read-only.
 */
function resolveClaudeLiveSessionPtyId(
  state: Pick<AppState, 'terminalLayoutsByTabId'>,
  tab: Pick<TerminalTab, 'id' | 'ptyId'>,
  tabAgent: TuiAgent | null
): string | null {
  if (tabAgent !== 'claude') {
    return null
  }
  const layout = state.terminalLayoutsByTabId[tab.id]
  const ptyId = (layout ? resolvePrimaryLayoutPtyId(layout) : null) ?? tab.ptyId
  // Why: a paired host's processes and Claude session files are not readable from this client.
  return ptyId && !ptyId.startsWith('remote:') ? ptyId : null
}

/** Click-time resolution: the reported session, else the one the live Claude process holds. */
export async function resolveForkableAgentSessionForLaunch(
  state: ForkableAgentSessionState,
  tab: Pick<TerminalTab, 'id' | 'ptyId'>,
  tabAgent: TuiAgent | null
): Promise<ForkableAgentSession | null> {
  const reported = resolveForkableAgentSession(state, tab, tabAgent)
  if (reported) {
    return reported
  }
  const ptyId = resolveClaudeLiveSessionPtyId(state, tab, tabAgent)
  if (!ptyId) {
    return null
  }
  const id = await window.api.pty.resolveClaudeSessionId(ptyId).catch(() => null)
  return id ? { agent: 'claude', providerSession: { key: 'session_id', id } } : null
}

/** Whether the tab's detected agent has a session the context menu can fork. */
export function useCanForkAgentSession(tab: TerminalTab, tabAgent: TuiAgent | null): boolean {
  return useAppStore(
    (s) =>
      resolveForkableAgentSession(s, tab, tabAgent) !== null ||
      resolveClaudeLiveSessionPtyId(s, tab, tabAgent) !== null
  )
}
