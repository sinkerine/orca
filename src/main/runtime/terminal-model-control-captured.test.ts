import { describe, expect, it } from 'vitest'
import { readRuntimeFixture, replayTranscript } from './agent-transcript-replay-test-harness'
import {
  readTerminalModelPickerScreen,
  terminalModelComposerProvider
} from './terminal-model-picker-screen'
import { controlTerminalModel, type TerminalModelRuntime } from './terminal-model-control'

async function capturedScreens(provider: 'codex' | 'claude' | 'pi') {
  const screens: string[][] = []
  for await (const frame of replayTranscript(
    readRuntimeFixture(`${provider}-native-model-selection`),
    120,
    40
  )) {
    screens.push(frame.screenLines)
  }
  const composer = screens.findLast((lines) => terminalModelComposerProvider(lines) === provider)
  const picker = screens.findLast(
    (lines) =>
      readTerminalModelPickerScreen(lines)?.provider === provider &&
      readTerminalModelPickerScreen(lines)?.phase === 'model'
  )
  const final = screens.at(-1)
  if (!composer || !picker || !final) {
    throw new Error('Missing captured state')
  }
  const effort = screens.findLast(
    (lines) => readTerminalModelPickerScreen(lines)?.phase === 'effort'
  )
  return { composer, picker, final, screens, effort }
}

describe('captured terminal model transactions', () => {
  it.each(['codex', 'claude', 'pi'] as const)(
    'applies a captured %s selection without replacing the PTY',
    async (provider) => {
      const capture = await capturedScreens(provider)
      let lines = capture.composer
      let phase = 'composer'
      const writes: string[] = []
      const runtime: TerminalModelRuntime = {
        resolveLiveLeafForHandle: () => ({ ptyId: `apply-${provider}` }),
        readTerminal: async () => ({
          handle: 'term',
          status: 'running',
          tail: lines,
          truncated: false,
          nextCursor: null,
          source: 'screen'
        }),
        getTerminalAgentStatus: async () => ({
          handle: 'term',
          isRunningAgent: true,
          status: 'idle'
        }),
        sendTerminal: async (_handle, action, options) => {
          await options.beforeWrite?.(`apply-${provider}`)
          writes.push(action.text ?? '')
          if (action.text === '/model') {
            phase = 'command'
            lines = [provider === 'pi' ? '/model' : provider === 'claude' ? '❯ /model' : '› /model']
          } else if (phase === 'command') {
            phase = 'model'
            lines = capture.picker
          } else if (provider === 'codex' && phase === 'model' && capture.effort) {
            phase = 'effort'
            lines = capture.effort
          } else {
            phase = 'applied'
            lines = capture.final
          }
          return {
            handle: 'term',
            accepted: true,
            bytesWritten: 1,
            writeSettlement: { outcome: 'accepted' }
          }
        }
      }
      let result = await controlTerminalModel(runtime, { terminal: 'term', action: 'open' })
      for (let step = 0; step < 2 && result.descriptor?.kind.type === 'select'; step++) {
        const parsed = readTerminalModelPickerScreen(lines)
        const choice = result.descriptor.kind.choices[(parsed?.selected ?? 1) - 1]
        result = await controlTerminalModel(runtime, {
          terminal: 'term',
          action: 'select',
          transactionId: result.transactionId,
          optionId: choice?.value
        })
      }
      expect(result.phase).toBe('applied')
      expect(writes.at(-1)).toBe(provider === 'pi' ? '\r' : 's')
    }
  )
  it.each(['codex', 'claude', 'pi'] as const)(
    'opens and cancels the actual %s picker',
    async (provider) => {
      const capture = await capturedScreens(provider)
      let lines = capture.composer
      const writes: string[] = []
      const runtime: TerminalModelRuntime = {
        resolveLiveLeafForHandle: () => ({ ptyId: `captured-${provider}` }),
        readTerminal: async () => ({
          handle: 'term',
          status: 'running',
          tail: lines,
          truncated: false,
          nextCursor: null,
          source: 'screen'
        }),
        getTerminalAgentStatus: async () => ({
          handle: 'term',
          isRunningAgent: true,
          status: 'idle'
        }),
        sendTerminal: async (_handle, action, options) => {
          await options.beforeWrite?.(`captured-${provider}`)
          writes.push(action.text ?? '')
          if (action.text === '/model') {
            lines = [provider === 'pi' ? '/model' : provider === 'claude' ? '❯ /model' : '› /model']
          }
          if (action.text === '\r') {
            lines = capture.picker
          }
          if (action.text === '\x1b') {
            lines = capture.composer
          }
          return {
            handle: 'term',
            accepted: true,
            bytesWritten: 1,
            writeSettlement: { outcome: 'accepted' }
          }
        }
      }
      const opened = await controlTerminalModel(runtime, { terminal: 'term', action: 'open' })
      expect(opened.phase).toBe('model')
      const cancelled = await controlTerminalModel(runtime, {
        terminal: 'term',
        action: 'cancel',
        transactionId: opened.transactionId
      })
      expect(cancelled.phase).toBe('cancelled')
      expect(writes).toEqual(['/model', '\r', '\x1b'])
    }
  )
})
