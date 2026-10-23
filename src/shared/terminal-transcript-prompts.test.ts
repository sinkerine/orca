import { expect, it } from 'vitest'
import { terminalTranscriptPrompts } from './terminal-transcript-prompts'

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
