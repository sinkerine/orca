import { buildAgentResumeStartupPlan, type AgentStartupPlan } from '@/lib/tui-agent-startup'
import { isForkableTuiAgent } from '../../../shared/agent-session-fork'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session-resume'
import type { AgentStartupShell } from '../../../shared/tui-agent-startup-shell'
import type { TuiAgent } from '../../../shared/tui-agent'

export type AgentSessionForkSource = {
  providerSession: AgentProviderSessionMetadata
  /** The source pane's own launch command/args/env; absent when Orca did not launch it. */
  launchConfig?: SleepingAgentLaunchConfig
}

/**
 * Startup plan that branches `source` into a new session. The fork argv rides
 * only on the typed command: launchConfig keeps the source's plain base command,
 * so a later restore or re-fork of the new tab never replays the fork.
 */
export function buildAgentSessionForkStartupPlan(args: {
  agent: TuiAgent
  source: AgentSessionForkSource
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  isRemote?: boolean
  /** Configured args/env, used only when the source has no launch config of its own. */
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
}): AgentStartupPlan | null {
  const { agent, source } = args
  if (!isForkableTuiAgent(agent)) {
    return null
  }
  const launchConfig = source.launchConfig
  return buildAgentResumeStartupPlan({
    agent,
    providerSession: source.providerSession,
    fork: true,
    cmdOverrides: args.cmdOverrides,
    platform: args.platform,
    shell: args.shell,
    isRemote: args.isRemote,
    // Why: a recorded agentCommand already carries its args, so it is used alone.
    agentArgs: launchConfig ? launchConfig.agentArgs : args.agentArgs,
    agentEnv: launchConfig ? launchConfig.agentEnv : args.agentEnv,
    ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {})
  })
}
