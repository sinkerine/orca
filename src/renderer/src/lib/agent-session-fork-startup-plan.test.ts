import { describe, expect, it } from 'vitest'
import { buildAgentSessionForkStartupPlan } from './agent-session-fork-startup-plan'

const base = { cmdOverrides: {}, platform: 'linux' as const }

describe('buildAgentSessionForkStartupPlan', () => {
  it('forks from the source launch config without persisting the fork argv', () => {
    // agentCommand already carries the args, exactly as a launch records it.
    const launchConfig = {
      agentCommand: 'my-codex-wrapper --profile fast',
      agentArgs: '--profile fast',
      agentEnv: { WRAPPER_ENV: 'yes' }
    }
    const plan = buildAgentSessionForkStartupPlan({
      ...base,
      agent: 'codex',
      source: { providerSession: { key: 'session_id', id: 'session-1' }, launchConfig },
      // Configured defaults must not leak into a session launched with its own config.
      agentArgs: '--configured-args',
      agentEnv: { CONFIGURED_ENV: 'yes' }
    })

    expect(plan?.launchCommand).toBe("my-codex-wrapper --profile fast 'fork' 'session-1'")
    expect(plan?.env).toEqual({ WRAPPER_ENV: 'yes' })
    // A restore or re-fork of the new tab must start from the plain base command.
    expect(plan?.launchConfig).toEqual(launchConfig)
  })

  it('forks a session Orca did not launch using the configured command, args and env', () => {
    const plan = buildAgentSessionForkStartupPlan({
      ...base,
      agent: 'claude',
      source: { providerSession: { key: 'session_id', id: 'session-1' } },
      cmdOverrides: { claude: 'cc' },
      agentArgs: '--verbose',
      agentEnv: { CONFIGURED_ENV: 'yes' }
    })

    expect(plan?.launchCommand).toBe("cc '--verbose' '--resume' 'session-1' '--fork-session'")
    expect(plan?.env).toEqual({ CONFIGURED_ENV: 'yes' })
    expect(plan?.launchConfig).toMatchObject({ agentCommand: "cc '--verbose'" })
  })

  it('builds no plan when the session cannot be forked', () => {
    // Pi forks by transcript file, which this session never reported.
    const source = { providerSession: { key: 'session_id' as const, id: 'session-1' } }

    expect(buildAgentSessionForkStartupPlan({ ...base, agent: 'pi', source })).toBeNull()
    expect(buildAgentSessionForkStartupPlan({ ...base, agent: 'gemini', source })).toBeNull()
  })
})
