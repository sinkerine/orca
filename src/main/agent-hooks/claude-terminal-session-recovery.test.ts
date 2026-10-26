import { describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import { PANE } from './server.test-fixtures'
import { createTerminalStatusSessionRecovery } from './claude-terminal-session-recovery'
import type { RuntimeTerminalAgentStatusEvent } from '../runtime/runtime-terminal-contracts'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: () => ({}) }))

function event(): RuntimeTerminalAgentStatusEvent {
  return {
    ptyId: 'pty-1',
    source: 'pty-record',
    paneKey: PANE,
    worktreeId: 'wt-1',
    payload: { state: 'done', prompt: '', agentType: 'claude' }
  }
}

describe('hookless Claude terminal recovery', () => {
  it('adds the process-owned session to an unchanged idle status and publishes it', async () => {
    const server = new AgentHookServer()
    const listener = vi.fn()
    server.setListener(listener)
    const resolve = vi.fn(async () => '11111111-1111-4111-8111-111111111111')
    const ingest = createTerminalStatusSessionRecovery(server, resolve)
    ingest(event())
    await vi.waitFor(() =>
      expect(server.getStatusSnapshot()[0]?.providerSession).toEqual({
        key: 'session_id',
        id: '11111111-1111-4111-8111-111111111111'
      })
    )
    expect(listener).toHaveBeenCalledTimes(2)
    ingest(event())
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent observations and discards a result after the pane moves on', async () => {
    const server = new AgentHookServer()
    let finish: (id: string) => void = () => {}
    const resolve = vi.fn(
      () =>
        new Promise<string>((done) => {
          finish = done
        })
    )
    const ingest = createTerminalStatusSessionRecovery(server, resolve)
    ingest(event())
    ingest(event())
    ingest({ ...event(), payload: { state: 'working', prompt: '', agentType: 'codex' } })
    finish('11111111-1111-4111-8111-111111111111')
    await Promise.resolve()
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(server.getStatusSnapshot()[0]?.providerSession).toBeUndefined()
  })

  it.each([
    { connectionId: 'ssh-host' },
    { ptyId: 'remote:environment@@terminal' },
    { ptyId: 'ssh:target@@terminal' }
  ])('never reads local sessions for remote work: %j', (remote) => {
    const server = new AgentHookServer()
    const resolve = vi.fn(async () => null)
    createTerminalStatusSessionRecovery(server, resolve)({ ...event(), ...remote })
    expect(resolve).not.toHaveBeenCalled()
  })
})
