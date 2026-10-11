import { describe, expect, it } from 'vitest'
import { getAgentForkArgv, isForkableTuiAgent } from './agent-session-fork'
import { buildAgentResumeStartupPlan } from './tui-agent-resume-startup'

describe('getAgentForkArgv', () => {
  it('branches each forkable agent from its own session locator', () => {
    expect(getAgentForkArgv('claude', { key: 'session_id', id: 'abc' })).toEqual([
      'claude',
      '--resume',
      'abc',
      '--fork-session'
    ])
    expect(getAgentForkArgv('codex', { key: 'session_id', id: 'abc' })).toEqual([
      'codex',
      'fork',
      'abc'
    ])
    expect(
      getAgentForkArgv('pi', { key: 'session_id', id: 'abc', transcriptPath: '/s/abc.jsonl' })
    ).toEqual(['pi', '--fork', '/s/abc.jsonl'])
  })

  it('refuses sessions without the locator the agent forks by', () => {
    expect(getAgentForkArgv('pi', { key: 'session_id', id: 'abc' })).toBeNull()
    expect(getAgentForkArgv('codex', { key: 'conversation_id', id: 'abc' })).toBeNull()
  })

  it('limits forking to agents with a fork CLI', () => {
    expect(isForkableTuiAgent('claude')).toBe(true)
    expect(isForkableTuiAgent('gemini')).toBe(false)
    expect(isForkableTuiAgent(null)).toBe(false)
  })
})

describe('buildAgentResumeStartupPlan fork mode', () => {
  it('keeps the fork argv out of the persisted launch config', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'pi',
      providerSession: { key: 'session_id', id: 'abc', transcriptPath: '/s/abc.jsonl' },
      fork: true,
      cmdOverrides: {},
      platform: 'linux',
      agentCommand: 'pi-alias --thinking high',
      agentArgs: '--thinking high',
      agentEnv: { PI_ENV: '1' }
    })

    expect(plan?.launchCommand).toBe("pi-alias --thinking high '--fork' '/s/abc.jsonl'")
    expect(plan?.launchConfig).toEqual({
      agentCommand: 'pi-alias --thinking high',
      agentArgs: '--thinking high',
      agentEnv: { PI_ENV: '1' }
    })
    expect(plan?.env).toEqual({ PI_ENV: '1' })
  })

  it('replaces a stale Claude resume selector with the fork selector', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'new' },
      fork: true,
      cmdOverrides: {},
      platform: 'linux',
      agentCommand: 'claude --resume old --verbose'
    })

    expect(plan?.launchCommand).toBe("claude --verbose '--resume' 'new' '--fork-session'")
  })

  it('returns no plan for an agent without a fork CLI', () => {
    expect(
      buildAgentResumeStartupPlan({
        agent: 'gemini',
        providerSession: { key: 'session_id', id: 'abc' },
        fork: true,
        cmdOverrides: {},
        platform: 'linux'
      })
    ).toBeNull()
  })
})
