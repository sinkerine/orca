import { expect, it } from 'vitest'
import {
  hasTerminalPromptTranscript,
  terminalTranscriptPrompts
} from './terminal-transcript-prompts'

it('loads Pi prompt history without enabling legacy Pi Chat UI', () => {
  expect(hasTerminalPromptTranscript('pi')).toBe(true)
  expect(hasTerminalPromptTranscript('claude')).toBe(true)
  expect(hasTerminalPromptTranscript('codex')).toBe(true)
  expect(hasTerminalPromptTranscript('unknown')).toBe(false)
})

it('extracts user text only and checks untrusted transcript shapes', () => {
  expect(
    terminalTranscriptPrompts([
      null,
      { id: 'assistant', role: 'assistant', blocks: [{ type: 'text', text: 'Not a prompt' }] },
      {
        id: 'user',
        role: 'user',
        blocks: [
          { type: 'text', text: 'First line' },
          { type: 'image' },
          { type: 'text', text: 'Second line' }
        ]
      },
      { id: 'bad', role: 'user', blocks: [null, { type: 'text', text: 1 }] }
    ])
  ).toEqual([{ id: 'user', text: 'First line\nSecond line' }])
})
