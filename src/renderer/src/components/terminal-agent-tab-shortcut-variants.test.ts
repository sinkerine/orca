import { beforeEach, describe, expect, it, vi } from 'vitest'

const stateMock = vi.hoisted(() => ({
  settings: {
    agentLaunchVariants: [
      { id: 'fast', name: 'Fast', agent: 'claude' as const, command: 'claude --fast' }
    ],
    defaultTuiAgent: 'claude' as const,
    disabledTuiAgents: [] as string[]
  },
  detectedAgentIds: ['claude'] as string[] | null,
  remoteDetectedAgentIds: {} as Record<string, string[] | null>,
  runtimeDetectedAgentIds: {} as Record<string, string[] | null>,
  localDetectedAgentIdsByContext: {} as Record<string, string[] | null>,
  ensureRuntimeDetectedAgents: vi.fn(async () => []),
  targetKey: 'local' as string | undefined
}))

vi.mock('../store', () => ({ useAppStore: { getState: () => stateMock } }))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  getAgentDetectionTargetKeyForWorktree: () => stateMock.targetKey,
  parseAgentDetectionTargetKey: () =>
    stateMock.targetKey === undefined
      ? undefined
      : stateMock.targetKey.startsWith('runtime:')
        ? { kind: 'runtime', environmentId: stateMock.targetKey.slice('runtime:'.length) }
        : stateMock.targetKey.startsWith('ssh:')
          ? { kind: 'ssh', connectionId: stateMock.targetKey.slice('ssh:'.length) }
          : { kind: 'local', contextKey: stateMock.targetKey === 'local:host' ? 'host' : undefined }
}))

import { agentVariantActionId } from '../../../shared/keybindings'
import { resolveTerminalAgentTabShortcut } from './terminal-agent-tab-shortcut'

describe('resolveTerminalAgentTabShortcut variants', () => {
  beforeEach(() => {
    stateMock.settings.disabledTuiAgents = []
    stateMock.detectedAgentIds = ['claude']
    stateMock.remoteDetectedAgentIds = {}
    stateMock.runtimeDetectedAgentIds = {}
    stateMock.targetKey = 'local'
    stateMock.localDetectedAgentIdsByContext = {}
  })

  it.each(['runtime:host-a', 'ssh:host-a', 'local', 'local:host', undefined])(
    'uses only the owning detection target for the default shortcut: %s',
    async (targetKey) => {
      stateMock.targetKey = targetKey
      stateMock.runtimeDetectedAgentIds['host-a'] = ['codex']
      stateMock.remoteDetectedAgentIds['host-a'] = ['pi']
      stateMock.localDetectedAgentIdsByContext.host = ['opencode']
      const expected =
        targetKey === 'runtime:host-a'
          ? 'codex'
          : targetKey === 'ssh:host-a'
            ? 'pi'
            : targetKey === 'local:host'
              ? 'opencode'
              : targetKey === 'local'
                ? 'claude'
                : null
      const result = resolveTerminalAgentTabShortcut({
        activeWorktreeId: 'wt-1',
        keybindings: {},
        matchShortcut: (candidate) => candidate === 'tab.newAgent'
      })
      expect(result).toMatchObject({ actionId: 'tab.newAgent', agent: expected })
      if (expected === null) {
        await expect(result.pendingAgent).resolves.toBeNull()
      } else {
        expect(result.pendingAgent).toBeUndefined()
      }
    }
  )

  it('does not select local agents while remote detection is pending', async () => {
    stateMock.targetKey = 'runtime:host-a'
    const result = resolveTerminalAgentTabShortcut({
      activeWorktreeId: 'folder:remote',
      keybindings: {},
      matchShortcut: (candidate) => candidate === 'tab.newAgent'
    })
    expect(result).toMatchObject({ actionId: 'tab.newAgent', agent: null })
    await expect(result.pendingAgent).resolves.toBeNull()
    expect(stateMock.ensureRuntimeDetectedAgents).toHaveBeenCalledWith('host-a', undefined)
  })

  it('resolves a bound variant only while its base agent is enabled and detected', () => {
    const actionId = agentVariantActionId('fast')
    const resolve = () =>
      resolveTerminalAgentTabShortcut({
        activeWorktreeId: 'wt-1',
        keybindings: { [actionId]: ['Ctrl+Shift+1'] },
        matchShortcut: (candidate) => candidate === actionId
      })

    expect(resolve()).toEqual({
      actionId,
      agent: 'claude',
      command: 'claude --fast'
    })
    stateMock.settings.disabledTuiAgents = ['claude']
    expect(resolve()).toEqual({ actionId: null, agent: null })
    stateMock.settings.disabledTuiAgents = []
    stateMock.detectedAgentIds = []
    expect(resolve()).toEqual({ actionId: null, agent: null })
  })

  it('uses detections from the runtime or SSH host that owns the worktree', () => {
    const actionId = agentVariantActionId('fast')
    const resolve = () =>
      resolveTerminalAgentTabShortcut({
        activeWorktreeId: 'wt-1',
        keybindings: { [actionId]: ['Ctrl+Shift+1'] },
        matchShortcut: (candidate) => candidate === actionId
      })

    stateMock.detectedAgentIds = []
    stateMock.targetKey = 'runtime:host-a'
    stateMock.runtimeDetectedAgentIds['host-a'] = ['claude']
    expect(resolve().command).toBe('claude --fast')
    stateMock.targetKey = 'ssh:host-b'
    stateMock.remoteDetectedAgentIds['host-b'] = ['codex']
    expect(resolve()).toEqual({ actionId: null, agent: null })
    stateMock.remoteDetectedAgentIds['host-b'] = ['claude']
    expect(resolve().command).toBe('claude --fast')
  })
})
