import { getAgentResumeArgv, type ResumableTuiAgent } from '../../../../shared/agent-session-resume'
import { buildAgentResumeLaunchCommand } from '../../../../shared/agent-resume-launch-command'
import { resolveStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { useAppStore } from '../../store'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { TUI_AGENT_CONFIG, getTuiAgentLaunchCommand } from '../../../../shared/tui-agent-config'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type ForkableAgentSession = { agent: ResumableTuiAgent; launchCommand: string }

const FORKABLE_AGENTS = new Set<ResumableTuiAgent>(['pi', 'codex', 'claude'])

function isForkableAgent(agent: TuiAgent | null): agent is ResumableTuiAgent {
  return agent !== null && FORKABLE_AGENTS.has(agent as ResumableTuiAgent)
}

function buildForkableSession(
  agent: ResumableTuiAgent,
  providerSession: NonNullable<AgentStatusEntry['providerSession']>,
  launchConfig: { agentCommand?: string; agentArgs?: string } | undefined
): ForkableAgentSession | null {
  if (!getAgentResumeArgv(agent, providerSession)) {
    return null
  }
  const baseCommand =
    launchConfig?.agentCommand ??
    getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[agent], getRendererAppPlatform())
  const forkArgv =
    agent === 'pi'
      ? ['pi', '--fork', providerSession.transcriptPath!]
      : agent === 'codex'
        ? ['codex', 'fork', providerSession.id]
        : ['claude', '--resume', providerSession.id, '--fork-session']
  const originalCommand = [baseCommand, launchConfig?.agentArgs]
    .filter((value) => value?.trim())
    .join(' ')
  return {
    agent,
    launchCommand: buildAgentResumeLaunchCommand(
      agent,
      originalCommand,
      forkArgv,
      resolveStartupShell(getRendererAppPlatform())
    )
  }
}

export function useForkableAgentSession(
  tab: TerminalTab,
  tabAgent: TuiAgent | null
): ForkableAgentSession | null {
  const serializedSession = useAppStore((s) => {
    if (!isForkableAgent(tabAgent)) {
      return ''
    }
    const panePrefix = `${tab.id}:`
    for (const [paneKey, status] of Object.entries(s.agentStatusByPaneKey)) {
      if (
        paneKey.startsWith(panePrefix) &&
        status.agentType === tabAgent &&
        status.providerSession
      ) {
        const session = buildForkableSession(
          tabAgent,
          status.providerSession,
          s.getAgentLaunchConfigForStatusEntry(status)
        )
        if (session) {
          return JSON.stringify(session)
        }
      }
    }
    // Restarted tabs may have restored provider identity before their first hook event.
    for (const [paneKey, record] of Object.entries(s.sleepingAgentSessionsByPaneKey)) {
      if (paneKey.startsWith(panePrefix) && record.agent === tabAgent) {
        const session = buildForkableSession(tabAgent, record.providerSession, record.launchConfig)
        if (session) {
          return JSON.stringify(session)
        }
      }
    }
    return ''
  })
  return serializedSession ? (JSON.parse(serializedSession) as ForkableAgentSession) : null
}
