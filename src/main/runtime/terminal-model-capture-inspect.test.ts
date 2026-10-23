import { describe, expect, it } from 'vitest'
import { readRuntimeFixture, replayTranscript } from './agent-transcript-replay-test-harness'
import {
  readTerminalModelPickerScreen,
  terminalModelComposerProvider
} from './terminal-model-picker-screen'

describe('captured native model pickers', () => {
  it.each(['codex', 'claude', 'pi'] as const)(
    'reads actual %s picker choices and empty composer',
    async (provider) => {
      let sawPicker = false
      let sawComposer = false
      for await (const frame of replayTranscript(
        readRuntimeFixture(`${provider}-native-model-selection`),
        120,
        40
      )) {
        const picker = readTerminalModelPickerScreen(frame.screenLines)
        if (picker?.provider === provider) {
          sawPicker = true
          expect(picker.rows.some((row) => row.number === picker.selected)).toBe(true)
        }
        if (terminalModelComposerProvider(frame.screenLines) === provider) {
          sawComposer = true
        }
      }
      expect(sawPicker).toBe(true)
      expect(sawComposer).toBe(true)
    }
  )
})

describe('narrow captured pickers', () => {
  it.each(['codex', 'claude', 'pi'] as const)(
    'never exposes clipped %s labels',
    async (provider) => {
      for await (const frame of replayTranscript(
        readRuntimeFixture(`${provider}-native-model-narrow`),
        60,
        24
      )) {
        const picker = readTerminalModelPickerScreen(frame.screenLines)
        if (!picker) {
          continue
        }
        expect(picker.rows.every((row) => !row.label.includes('…'))).toBe(true)
      }
    }
  )
})
