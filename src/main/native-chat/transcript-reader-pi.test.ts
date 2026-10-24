import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readNativeChatTranscript } from './transcript-reader'
import { readNativeChatTranscriptTail } from './transcript-watch'
import { terminalTranscriptPrompts } from '../../shared/terminal-transcript-prompts'
import { isNativeChatSupportedAgent } from '../../shared/native-chat-agent-support'

it('reads Pi user prompts from the hook path through the existing bounded reader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-pi-prompts-'))
  try {
    const transcriptPath = join(root, 'session.jsonl')
    const records = [
      { type: 'session', id: 'pi-session', version: 3 },
      ...['Earlier prompt', 'Newest prompt'].flatMap((text, index) => [
        {
          type: 'message',
          id: `user-${index}`,
          message: { role: 'user', content: [{ type: 'text', text }] }
        },
        {
          type: 'message',
          id: `assistant-${index}`,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Response' }] }
        }
      ])
    ]
    await writeFile(
      transcriptPath,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    )
    const result = await readNativeChatTranscriptTail({
      agent: 'pi',
      sessionId: 'pi-session',
      transcriptPath,
      limit: 200
    })
    expect('messages' in result ? terminalTranscriptPrompts(result.messages) : result).toEqual([
      { id: 'user-0', text: 'Earlier prompt' },
      { id: 'user-1', text: 'Newest prompt' }
    ])
    const full = await readNativeChatTranscript('pi', 'pi-session', { transcriptPath })
    expect('messages' in full ? full.messages.length : full).toBe(4)
    expect(isNativeChatSupportedAgent('pi')).toBe(false)
    const missing = await readNativeChatTranscript('pi', 'pi-session')
    expect(missing).toMatchObject({ notFound: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
