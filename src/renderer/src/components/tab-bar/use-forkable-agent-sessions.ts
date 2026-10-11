import { getAgentResumeArgv, type ResumableTuiAgent } from '../../../../shared/agent-session-resume'
import { buildAgentResumeLaunchCommand } from '../../../../shared/agent-resume-launch-command'
import { resolveStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { useAppStore } from '../../store'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

export function useForkableAgentSessions(
  tab: TerminalTab
): { agent: ResumableTuiAgent; launchCommand: string }[] {
  return useAppStore((s) => {
    const sessions: { agent: ResumableTuiAgent; launchCommand: string }[] = []
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
      const launchConfig = s.getAgentLaunchConfigForStatusEntry(status)
      if (!resumeArgv || !launchConfig?.agentCommand) {
        continue
      }
      const forkArgv =
        resumableAgent === 'pi'
          ? ['pi', '--fork', status.providerSession.transcriptPath!]
          : resumableAgent === 'codex'
            ? ['codex', 'fork', status.providerSession.id]
            : ['claude', '--resume', status.providerSession.id, '--fork-session']
      const originalCommand = [launchConfig.agentCommand, launchConfig.agentArgs]
        .filter((value) => value.trim())
        .join(' ')
      sessions.push({
        agent: resumableAgent,
        launchCommand: buildAgentResumeLaunchCommand(
          resumableAgent,
          originalCommand,
          forkArgv,
          resolveStartupShell(process.platform)
        )
      })
    }
    return sessions
  })
}
