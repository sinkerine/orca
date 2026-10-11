import { getAgentResumeArgv, type ResumableTuiAgent } from '../../../../shared/agent-session-resume'
import { buildAgentResumeLaunchCommand } from '../../../../shared/agent-resume-launch-command'
import { resolveStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { useAppStore } from '../../store'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

type ForkableAgentSession = { agent: ResumableTuiAgent; launchCommand: string }

export function useForkableAgentSessions(tab: TerminalTab): ForkableAgentSession[] {
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
          resolveStartupShell(getRendererAppPlatform())
        )
      })
    }
    return sessions.length > 0 ? JSON.stringify(sessions) : ''
  })
  return serializedSessions ? (JSON.parse(serializedSessions) as ForkableAgentSession[]) : []
}
