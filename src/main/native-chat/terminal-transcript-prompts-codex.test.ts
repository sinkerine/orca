import { expect, it } from 'vitest'
import { terminalTranscriptPrompts } from '../../shared/terminal-transcript-prompts'
import { decodeCodexTranscriptLine } from './transcript-line-decoders-codex'

it('supplies banner prompts from Codex rollout formats without assistant or skill context', () => {
  const records = [
    {
      type: 'response_item',
      payload: {
        type: 'message',
        id: 'response-prompt',
        role: 'user',
        content: [
          { type: 'text', text: 'Review the first change' },
          { type: 'text', text: '<skill>Internal skill instructions</skill>' }
        ]
      }
    },
    {
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Assistant response' }
    },
    {
      type: 'event_msg',
      payload: { type: 'user_message', id: 'event-prompt', message: 'Review the next change' }
    },
    {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'UserMessage',
          id: 'completed-prompt',
          content: [{ type: 'Text', text: 'Verify the final change' }]
        }
      }
    }
  ]
  const messages = records.map((record, index) =>
    decodeCodexTranscriptLine(JSON.stringify(record), `row-${index}`)
  )
  expect(terminalTranscriptPrompts(messages)).toEqual([
    { id: 'response-prompt', text: 'Review the first change' },
    { id: 'event-prompt', text: 'Review the next change' },
    { id: 'completed-prompt', text: 'Verify the final change' }
  ])
})
