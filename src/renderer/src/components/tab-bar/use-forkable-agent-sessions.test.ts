/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useForkableAgentSession } from './use-forkable-agent-sessions'

const storeMock = vi.hoisted(() => ({
  state: {
    agentStatusByPaneKey: {} as Record<string, AgentStatusEntry>,
    getAgentLaunchConfigForStatusEntry: vi.fn(
      (): { agentCommand?: string; agentArgs?: string } | undefined => undefined
    ),
    sleepingAgentSessionsByPaneKey: {}
  }
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state)
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

function status(agentType: 'pi' | 'codex' | 'claude'): AgentStatusEntry {
  return {
    paneKey: 'tab-1:leaf-1',
    tabId: 'tab-1',
    worktreeId: 'worktree-1',
    agentType,
    state: 'working',
    prompt: 'work',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    providerSession:
      agentType === 'pi'
        ? {
            key: 'session_id',
            id: 'pi-session',
            transcriptPath: '/tmp/pi-session.jsonl'
          }
        : { key: 'session_id', id: `${agentType}-session` }
  } as AgentStatusEntry
}

describe('useForkableAgentSession', () => {
  beforeEach(() => {
    storeMock.state.agentStatusByPaneKey = {}
    storeMock.state.sleepingAgentSessionsByPaneKey = {}
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReset()
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReturnValue(undefined)
  })

  it.each(['pi', 'codex', 'claude'] as const)(
    'recognizes a running %s session without transient launch config',
    (agentType) => {
      storeMock.state.agentStatusByPaneKey = {
        'tab-1:leaf-1': status(agentType)
      }

      const { result } = renderHook(() => useForkableAgentSession(tab, agentType))

      expect(result.current?.agent).toBe(agentType)
      expect(result.current?.launchCommand).toContain(
        agentType === 'pi'
          ? "pi '--fork'"
          : agentType === 'codex'
            ? "codex 'fork'"
            : "claude '--resume'"
      )
    }
  )

  it('uses live status identity instead of an aliased launch command', () => {
    storeMock.state.agentStatusByPaneKey = {
      'tab-1:leaf-1': status('codex')
    }
    storeMock.state.getAgentLaunchConfigForStatusEntry.mockReturnValue({
      agentCommand: 'my-codex-wrapper',
      agentArgs: '--profile fast'
    })

    const { result } = renderHook(() => useForkableAgentSession(tab, 'codex'))

    expect(result.current?.agent).toBe('codex')
    expect(result.current?.launchCommand).toContain('my-codex-wrapper')
    expect(result.current?.launchCommand).toContain("'fork'")
  })

  it('uses restored provider identity after restart before live hook status arrives', () => {
    storeMock.state.sleepingAgentSessionsByPaneKey = {
      'tab-1:leaf-1': {
        paneKey: 'tab-1:leaf-1',
        tabId: 'tab-1',
        worktreeId: 'worktree-1',
        agent: 'claude',
        providerSession: { key: 'session_id', id: 'claude-session' },
        prompt: '',
        state: 'working',
        capturedAt: 1,
        updatedAt: 1,
        launchConfig: { agentCommand: 'claude-wrapper', agentArgs: '' }
      }
    }

    const { result } = renderHook(() => useForkableAgentSession(tab, 'claude'))

    expect(result.current?.agent).toBe('claude')
    expect(result.current?.launchCommand).toContain('claude-wrapper')
  })

  it('does not use a provider session from another tab', () => {
    storeMock.state.agentStatusByPaneKey = {
      'tab-2:leaf-1': status('codex')
    }

    const { result } = renderHook(() => useForkableAgentSession(tab, 'codex'))

    expect(result.current).toBeNull()
  })
})
