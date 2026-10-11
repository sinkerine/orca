/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type {
  SleepingAgentLaunchConfig,
  SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  resolveForkableAgentSession,
  resolveForkableAgentSessionForLaunch,
  useCanForkAgentSession
} from './use-forkable-agent-sessions'

const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'

const runtimeOwner = vi.hoisted(() => ({ environmentId: null as string | null }))

const storeMock = vi.hoisted(() => ({
  state: {
    agentStatusByPaneKey: {} as Record<string, AgentStatusEntry>,
    sleepingAgentSessionsByPaneKey: {} as Record<string, SleepingAgentSessionRecord>,
    terminalLayoutsByTabId: {} as Record<string, { activeLeafId: string | null }>,
    getAgentLaunchConfigForStatusEntry: vi.fn(
      (_entry: AgentStatusEntry): SleepingAgentLaunchConfig | undefined => undefined
    )
  }
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state)
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => runtimeOwner.environmentId
}))

const tab: TerminalTab = {
  id: 'tab-1',
  ptyId: 'pty-1',
  worktreeId: 'worktree-1',
  title: 'Agent',
  customTitle: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
}

function status(
  agentType: 'pi' | 'codex' | 'claude',
  paneKey = `tab-1:${LEAF_1}`,
  id = `${agentType}-session`
): AgentStatusEntry {
  return {
    paneKey,
    tabId: paneKey.split(':')[0],
    worktreeId: 'worktree-1',
    agentType,
    state: 'working',
    prompt: 'work',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    providerSession:
      agentType === 'pi'
        ? { key: 'session_id', id, transcriptPath: `/tmp/${id}.jsonl` }
        : { key: 'session_id', id }
  } as AgentStatusEntry
}

function resolve(tabAgent: Parameters<typeof resolveForkableAgentSession>[2]) {
  return resolveForkableAgentSession(
    storeMock.state as unknown as Parameters<typeof resolveForkableAgentSession>[0],
    tab,
    tabAgent
  )
}

describe('resolveForkableAgentSession', () => {
  beforeEach(() => {
    runtimeOwner.environmentId = null
    storeMock.state.agentStatusByPaneKey = {}
    storeMock.state.sleepingAgentSessionsByPaneKey = {}
    storeMock.state.terminalLayoutsByTabId = {}
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReset()
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReturnValue(undefined)
  })

  it.each(['pi', 'codex', 'claude'] as const)(
    'resolves a running %s session from live status alone',
    (agentType) => {
      storeMock.state.agentStatusByPaneKey = { [`tab-1:${LEAF_1}`]: status(agentType) }

      expect(resolve(agentType)).toEqual({
        agent: agentType,
        providerSession: status(agentType).providerSession
      })
    }
  )

  it('identifies the agent from live status, not from an aliased launch command', () => {
    storeMock.state.agentStatusByPaneKey = { [`tab-1:${LEAF_1}`]: status('codex') }
    const launchConfig = {
      agentCommand: 'my-wrapper --profile fast',
      agentArgs: '--profile fast',
      agentEnv: {}
    }
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReturnValue(launchConfig)

    expect(resolve('codex')).toEqual({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'codex-session' },
      launchConfig
    })
    // A status row for a different agent than the one detected is not this tab's session.
    expect(resolve('claude')).toBeNull()
  })

  it('prefers the focused pane of a split tab', () => {
    storeMock.state.agentStatusByPaneKey = {
      [`tab-1:${LEAF_1}`]: status('claude', `tab-1:${LEAF_1}`, 'background'),
      [`tab-1:${LEAF_2}`]: status('claude', `tab-1:${LEAF_2}`, 'focused')
    }
    storeMock.state.terminalLayoutsByTabId = { 'tab-1': { activeLeafId: LEAF_2 } }

    expect(resolve('claude')?.providerSession.id).toBe('focused')
  })

  it('uses restored provider identity after restart before live hook status arrives', () => {
    const launchConfig = { agentCommand: 'claude-wrapper', agentArgs: '', agentEnv: {} }
    storeMock.state.sleepingAgentSessionsByPaneKey = {
      [`tab-1:${LEAF_1}`]: {
        paneKey: `tab-1:${LEAF_1}`,
        tabId: 'tab-1',
        worktreeId: 'worktree-1',
        agent: 'claude',
        providerSession: { key: 'session_id', id: 'claude-session' },
        prompt: '',
        state: 'working',
        capturedAt: 1,
        updatedAt: 1,
        launchConfig
      }
    }

    expect(resolve('claude')).toEqual({
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'claude-session' },
      launchConfig
    })
  })

  it('ignores sessions from other tabs, unforkable agents, and Pi without a transcript', () => {
    storeMock.state.agentStatusByPaneKey = {
      [`tab-2:${LEAF_1}`]: status('codex', `tab-2:${LEAF_1}`)
    }
    expect(resolve('codex')).toBeNull()

    const pi = status('pi')
    storeMock.state.agentStatusByPaneKey = {
      [`tab-1:${LEAF_1}`]: { ...pi, providerSession: { key: 'session_id', id: 'pi-session' } }
    }
    expect(resolve('pi')).toBeNull()
    expect(resolve('gemini')).toBeNull()
    expect(resolve(null)).toBeNull()
  })
})

describe('useCanForkAgentSession', () => {
  beforeEach(() => {
    runtimeOwner.environmentId = null
    storeMock.state.agentStatusByPaneKey = { [`tab-1:${LEAF_1}`]: status('claude') }
    storeMock.state.sleepingAgentSessionsByPaneKey = {}
  })

  it('enables forking for the detected agent', () => {
    expect(renderHook(() => useCanForkAgentSession(tab, 'claude')).result.current).toBe(true)
    expect(renderHook(() => useCanForkAgentSession(tab, null)).result.current).toBe(false)
  })

  it('stays disabled on a paired runtime host, which would drop the fork argv', () => {
    runtimeOwner.environmentId = 'env-1'

    expect(renderHook(() => useCanForkAgentSession(tab, 'claude')).result.current).toBe(false)
  })

  it('enables a live Claude tab that never reported a session, but not other agents', () => {
    storeMock.state.agentStatusByPaneKey = {}

    expect(renderHook(() => useCanForkAgentSession(tab, 'claude')).result.current).toBe(true)
    expect(renderHook(() => useCanForkAgentSession(tab, 'codex')).result.current).toBe(false)
    expect(
      renderHook(() => useCanForkAgentSession({ ...tab, ptyId: null }, 'claude')).result.current
    ).toBe(false)
  })
})

describe('resolveForkableAgentSessionForLaunch', () => {
  const resolveClaudeSessionId = vi.fn<(id: string) => Promise<string | null>>()
  const resolveForLaunch = (tabAgent: Parameters<typeof resolveForkableAgentSession>[2]) =>
    resolveForkableAgentSessionForLaunch(
      storeMock.state as unknown as Parameters<typeof resolveForkableAgentSession>[0],
      tab,
      tabAgent
    )

  beforeEach(() => {
    storeMock.state.agentStatusByPaneKey = {}
    storeMock.state.sleepingAgentSessionsByPaneKey = {}
    storeMock.state.terminalLayoutsByTabId = {}
    resolveClaudeSessionId.mockReset()
    vi.stubGlobal('api', { pty: { resolveClaudeSessionId } })
  })

  it('asks the live Claude process for its session when no hook reported one', async () => {
    resolveClaudeSessionId.mockResolvedValue('live-claude-session')

    await expect(resolveForLaunch('claude')).resolves.toEqual({
      agent: 'claude',
      providerSession: { key: 'session_id', id: 'live-claude-session' }
    })
    expect(resolveClaudeSessionId).toHaveBeenCalledWith('pty-1')
  })

  it('prefers a reported session and never probes for other agents', async () => {
    storeMock.state.agentStatusByPaneKey = { [`tab-1:${LEAF_1}`]: status('claude') }

    await expect(resolveForLaunch('claude')).resolves.toMatchObject({
      providerSession: { id: 'claude-session' }
    })
    storeMock.state.agentStatusByPaneKey = {}
    await expect(resolveForLaunch('codex')).resolves.toBeNull()
    expect(resolveClaudeSessionId).not.toHaveBeenCalled()
  })

  it('resolves nothing when the live process has no session', async () => {
    resolveClaudeSessionId.mockResolvedValue(null)

    await expect(resolveForLaunch('claude')).resolves.toBeNull()
  })
})
