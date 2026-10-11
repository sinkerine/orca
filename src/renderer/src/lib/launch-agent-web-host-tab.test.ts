import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'

const mockCreateWebRuntimeSessionTerminal = vi.fn()

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ tabsByWorktree: {}, setActiveTabType: vi.fn() }) }
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeAgentSessionTerminal: vi.fn(),
  createWebRuntimeAgentSessionTerminalWithLaunchDraft: vi.fn(),
  createWebRuntimeSessionTerminal: mockCreateWebRuntimeSessionTerminal,
  isWebTerminalSurfaceTabId: () => true
}))

const startupPlan = {
  launchCommand: "codex 'fork' 'codex-session'",
  launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} }
} as AgentStartupPlan

const base = {
  agent: 'codex' as const,
  worktreeId: 'wt-1',
  environmentId: 'env-1',
  startupPlan,
  prompt: '',
  promptDelivery: 'auto-submit' as const,
  pastePromptAfterReady: null,
  submitPastedPrompt: false
}

describe('launchAgentInWebHostTab', () => {
  beforeEach(() => {
    mockCreateWebRuntimeSessionTerminal.mockReset()
    mockCreateWebRuntimeSessionTerminal.mockResolvedValue({ status: 'created' })
  })

  it('lets the host build a promptless launch from the agent id', async () => {
    const { launchAgentInWebHostTab } = await import('./launch-agent-web-host-tab')

    await launchAgentInWebHostTab(base)

    const launch = mockCreateWebRuntimeSessionTerminal.mock.calls[0][0]
    expect(launch).toMatchObject({ agent: 'codex' })
    expect(launch).not.toHaveProperty('command')
  })

  it('sends the built command for a promptless fork', async () => {
    const { launchAgentInWebHostTab } = await import('./launch-agent-web-host-tab')

    await launchAgentInWebHostTab({ ...base, sendLaunchCommand: true })

    const launch = mockCreateWebRuntimeSessionTerminal.mock.calls[0][0]
    expect(launch).toMatchObject({
      launchAgent: 'codex',
      command: "codex 'fork' 'codex-session'",
      launchConfig: startupPlan.launchConfig
    })
    expect(launch).not.toHaveProperty('agent')
    expect(launch).not.toHaveProperty('prompt')
  })
})
