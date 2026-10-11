import type { AgentProviderSessionMetadata, ResumableTuiAgent } from './agent-session-resume'

export const FORKABLE_TUI_AGENTS = [
  'claude',
  'codex',
  'pi'
] as const satisfies readonly ResumableTuiAgent[]

export type ForkableTuiAgent = (typeof FORKABLE_TUI_AGENTS)[number]

const FORKABLE_TUI_AGENT_SET: ReadonlySet<string> = new Set(FORKABLE_TUI_AGENTS)

export function isForkableTuiAgent(value: unknown): value is ForkableTuiAgent {
  return typeof value === 'string' && FORKABLE_TUI_AGENT_SET.has(value)
}

/** Argv that branches the provider session into a new one, leaving the source untouched. */
export function getAgentForkArgv(
  agent: ForkableTuiAgent,
  providerSession: AgentProviderSessionMetadata
): string[] | null {
  if (providerSession.key !== 'session_id') {
    return null
  }
  switch (agent) {
    case 'claude':
      return ['claude', '--resume', providerSession.id, '--fork-session']
    case 'codex':
      return ['codex', 'fork', providerSession.id]
    case 'pi':
      return providerSession.transcriptPath
        ? ['pi', '--fork', providerSession.transcriptPath]
        : null
  }
}
