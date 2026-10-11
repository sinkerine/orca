import { getAgentResumeArgv, type ResumableTuiAgent } from '../../../../shared/agent-session-resume'
import { buildAgentResumeLaunchCommand } from '../../../../shared/agent-resume-launch-command'
import { resolveStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { useAppStore } from '../../store'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import { TUI_AGENT_CONFIG, getTuiAgentLaunchCommand } from '../../../../shared/tui-agent-config'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

export type ForkableAgentSession = { agent: ResumableTuiAgent; launchCommand: string }

export function useForkableAgentSession(tab: TerminalTab): ForkableAgentSession | null {
  // Why: a selector returning a fresh array re-renders forever; select a stable string instead.
  const serializedSessions = useAppStore((s) => {
    const sessions: ForkableAgentSession[] = []
    const panePrefix = `${tab.id}:`
    for (const [paneKey, status] of Object.entries(s.agentStatusByPaneKey)) {
      if (!paneKey.startsWith(panePrefix) || !status.providerSession) {
        continue
      }
      const agentType = status.agentType
      if (agentType !== 'pi' && agentType !== 'codex' && agentType !== 'claude') {
        continue
      }
      const resumableAgent = agentType as ResumableTuiAgent
      const resumeArgv = getAgentResumeArgv(resumableAgent, status.providerSession)
      if (!resumeArgv) {
        continue
      }
      const launchConfig = s.getAgentLaunchConfigForStatusEntry(status)
      const baseCommand =
        launchConfig?.agentCommand ??
        getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[resumableAgent], getRendererAppPlatform())
      const forkArgv =
        resumableAgent === 'pi'
          ? ['pi', '--fork', status.providerSession.transcriptPath!]
          : resumableAgent === 'codex'
            ? ['codex', 'fork', status.providerSession.id]
            : ['claude', '--resume', status.providerSession.id, '--fork-session']
      const originalCommand = [baseCommand, launchConfig?.agentArgs]
        .filter((value) => value?.trim())
        .join(' ')
      sessions.push({
        agent: resumableAgent,
        launchCommand: buildAgentResumeLaunchCommand(
          resumableAgent,
          originalCommand,
          forkArgv,
          resolveStartupShell(getRendererAppPlatform())
        )
      })
    }
    return sessions.length > 0 ? JSON.stringify(sessions[0]) : ''
  })
  return serializedSessions ? (JSON.parse(serializedSessions) as ForkableAgentSession) : null
}
