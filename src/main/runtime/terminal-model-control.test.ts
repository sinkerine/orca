import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlTerminalModel, type TerminalModelRuntime } from './terminal-model-control'
import { terminalModelInputAllowed } from './terminal-model-input-lease'

function harness() {
  let ptyId = 'model-test-pty'
  let lines = ['OpenAI Codex', '› Ask Codex to do anything']
  const writes: string[] = []
  const picker = [
    'Select Model and Effort',
    '› 1. One (current)  First',
    '  2. Two  Second',
    'enter select · esc back'
  ]
  const runtime: TerminalModelRuntime = {
    resolveLiveLeafForHandle: () => ({ ptyId }),
    readTerminal: async () => ({
      handle: 'term',
      status: 'running',
      tail: lines,
      truncated: false,
      nextCursor: null,
      source: 'screen'
    }),
    getTerminalAgentStatus: async () => ({ handle: 'term', isRunningAgent: true, status: 'idle' }),
    sendTerminal: async (_handle, action, options) => {
      await options.beforeWrite?.(ptyId)
      expect(terminalModelInputAllowed(ptyId)).toBe(true)
      writes.push(action.text ?? '')
      if (action.text === '/model') {
        lines = ['› /model']
      }
      if (action.text === '\r') {
        lines = picker
      }
      return {
        handle: 'term',
        accepted: true,
        bytesWritten: 1,
        writeSettlement: { outcome: 'accepted' }
      }
    }
  }
  return {
    runtime,
    writes,
    replace: () => {
      ptyId = 'replacement'
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('terminal model transaction', () => {
  it('recovers the transaction when an opening reply was lost', async () => {
    const h = harness()
    const opened = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    const recovered = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    expect(recovered.phase).toBe('uncertain')
    expect(recovered.transactionId).toBe(opened.transactionId)
    expect(h.writes).toEqual(['/model', '\r'])
    await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'release',
      transactionId: recovered.transactionId
    })
    expect(terminalModelInputAllowed('model-test-pty')).toBe(true)
  })

  it('refuses an existing composer draft hidden by the screen projection', async () => {
    const h = harness()
    h.runtime.readTerminal = async () => ({
      handle: 'term',
      status: 'running',
      tail: ['Claude Code', '❯', 'bypass permissions on · for agents'],
      draft: 'unfinished prompt',
      truncated: false,
      nextCursor: null,
      source: 'screen'
    })
    const refused = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    expect(refused.phase).toBe('unavailable')
    expect(h.writes).toEqual([])
    expect(terminalModelInputAllowed('model-test-pty')).toBe(true)
  })

  it('leases exact PTY, rejects stale option IDs, and explicitly releases input', async () => {
    const h = harness()
    const opened = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    expect(opened.phase).toBe('model')
    expect(h.writes).toEqual(['/model', '\r'])
    expect(terminalModelInputAllowed('model-test-pty')).toBe(false)
    const rejected = await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'select',
      transactionId: opened.transactionId,
      optionId: 'stale'
    })
    expect(rejected.phase).toBe('uncertain')
    expect(h.writes).toHaveLength(2)
    await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'release',
      transactionId: opened.transactionId
    })
    expect(terminalModelInputAllowed('model-test-pty')).toBe(true)
  })

  it('never writes into a replacement PTY', async () => {
    const h = harness()
    const opened = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    h.replace()
    expect(
      (
        await controlTerminalModel(h.runtime, {
          terminal: 'term',
          action: 'cancel',
          transactionId: opened.transactionId
        })
      ).phase
    ).toBe('uncertain')
    expect(h.writes).toHaveLength(2)
    await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'release',
      transactionId: opened.transactionId
    })
  })

  it('expires descriptors and permits recovery without sending guessed keys', async () => {
    vi.useFakeTimers()
    const h = harness()
    const opened = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(terminalModelInputAllowed('model-test-pty')).toBe(true)
    expect(
      (
        await controlTerminalModel(h.runtime, {
          terminal: 'term',
          action: 'select',
          transactionId: opened.transactionId,
          optionId: 'old'
        })
      ).phase
    ).toBe('unavailable')
    expect(h.writes).toHaveLength(2)
    const reopened = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    expect(reopened.message).not.toBe('A model picker is already open.')
    await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'release',
      transactionId: reopened.transactionId
    })
  })

  it('refuses busy agents before any input', async () => {
    const h = harness()
    h.runtime.getTerminalAgentStatus = async () => ({
      handle: 'term',
      isRunningAgent: true,
      status: 'working'
    })
    const result = await controlTerminalModel(h.runtime, { terminal: 'term', action: 'open' })
    expect(result.phase).toBe('unavailable')
    expect(terminalModelInputAllowed('model-test-pty')).toBe(true)
    expect(h.writes).toEqual([])
    await controlTerminalModel(h.runtime, {
      terminal: 'term',
      action: 'release',
      transactionId: result.transactionId
    })
  })
})
