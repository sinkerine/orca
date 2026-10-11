import { useAppStore } from '../../store'
import type { AppState } from '../../store/types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getAgentForkArgv, isForkableTuiAgent } from '../../../../shared/agent-session-fork'
import type { ForkableTuiAgent } from '../../../../shared/agent-session-fork'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'
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

/** Whether the tab's detected agent has a session the context menu can fork. */
export function useCanForkAgentSession(tab: TerminalTab, tabAgent: TuiAgent | null): boolean {
  return useAppStore(
    (s) =>
      resolveForkableAgentSession(s, tab, tabAgent) !== null &&
      // Why: a paired runtime host rebuilds agent launches from the agent id, which would
      // silently drop the fork argv and start an unrelated fresh session.
      getRuntimeEnvironmentIdForWorktree(s, tab.worktreeId) === null
  )
}
