import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import {
  TerminalPromptHistory,
  terminalPromptHistory
} from '../../../../shared/terminal-prompt-history'

const terminals: Terminal[] = []
function fixture(scrollback = 1000) {
  const terminal = new Terminal({ cols: 80, rows: 5, scrollback, allowProposedApi: true })
  terminals.push(terminal)
  const history = new TerminalPromptHistory(terminal)
  const write = (text: string): Promise<void> =>
    new Promise((resolve) => terminal.write(text, resolve))
  return { terminal, history, write }
}
afterEach(() => {
  for (const terminal of terminals.splice(0)) {
    terminal.dispose()
  }
})

describe('viewport prompt context', () => {
  it('selects by buffer position even when seeded prompts follow retained sessions', async () => {
    const { terminal, history, write } = fixture()
    await write(`> Retained old prompt\r\n${'old\r\n'.repeat(15)}`)
    history.acceptStatus({ prompt: 'Retained old prompt' })
    await write(`> Seeded later prompt\r\n${'later\r\n'.repeat(15)}`)
    history.seedPrompts([{ id: 'later', text: 'Seeded later prompt' }])
    terminal.scrollToLine(20)
    history.refreshPositions()
    expect(history.current()).toBe('Seeded later prompt')
  })

  it('skips the buffer scan at the live bottom and positions prompts once scrolled back', async () => {
    const { terminal, history, write } = fixture()
    history.acceptStatus({ prompt: 'Newest prompt' }, false)
    history.seedPrompts([{ id: 'old', text: 'Earlier prompt' }])
    await write(
      `> Earlier prompt\r\n${'old\r\n'.repeat(15)}> Newest prompt\r\n${'new\r\n'.repeat(15)}`
    )
    const getLine = vi.spyOn(terminal.buffer.active, 'getLine')
    history.refreshPositions()
    expect(getLine).not.toHaveBeenCalled()
    expect(history.current()).toBe('Newest prompt')
    terminal.scrollToLine(5)
    history.refreshPositions()
    expect(getLine).toHaveBeenCalled()
    expect(history.current()).toBe('Earlier prompt')
  })

  it('updates scroll context from prompts loaded after mount and replay', async () => {
    const { terminal, history, write } = fixture()
    history.acceptStatus({ prompt: 'Newest prompt' }, false)
    history.seedPrompts([{ id: 'old', text: 'Earlier prompt' }])
    await write(
      `> Earlier prompt\r\n${'old response\r\n'.repeat(
        15
      )}> Newest prompt\r\n${'new response\r\n'.repeat(15)}`
    )
    terminal.scrollToLine(5)
    history.refreshPositions()
    expect(history.current()).toBe('Earlier prompt')
    terminal.scrollToLine(20)
    history.refreshPositions()
    expect(history.current()).toBe('Newest prompt')
    expect(history.currentLine()).toBe(16)
  })

  it('recovers earlier prompt markers after a TUI clears and redraws its history', async () => {
    const { terminal, history, write } = fixture()
    const transcript = `> Earlier prompt\r\n${'old response\r\n'.repeat(15)}> Newest prompt\r\n${'new response\r\n'.repeat(15)}`
    await write(transcript)
    history.acceptStatus({ prompt: 'Newest prompt' }, false)
    history.seedPrompts([{ id: 'old', text: 'Earlier prompt' }])
    terminal.scrollToLine(5)
    history.refreshPositions()
    expect(history.current()).toBe('Earlier prompt')
    await write('\u001b[2J\u001b[3J\u001b[H')
    await write(transcript)
    terminal.scrollToLine(5)
    history.refreshPositions()
    expect(history.current()).toBe('Earlier prompt')
    expect(history.currentLine()).toBe(0)
    terminal.scrollToBottom()
    expect(history.current()).toBe('Newest prompt')
  })

  it('retains history across banner remounts for the same terminal only', () => {
    const a = fixture()
    const b = fixture()
    const retained = terminalPromptHistory(a.terminal)
    retained.acceptStatus({ prompt: 'Retained prompt' })
    expect(terminalPromptHistory(a.terminal)).toBe(retained)
    expect(terminalPromptHistory(a.terminal).current()).toBe('Retained prompt')
    expect(terminalPromptHistory(b.terminal).current()).toBeNull()
  })

  it('resolves a status mounted before scrollback replay on the first click', async () => {
    const { history, write } = fixture()
    history.acceptStatus({ prompt: 'Replay this prompt', restoredUnconfirmed: true }, false)
    expect(history.currentLine()).toBeNull()
    await write(`startup\r\n> Replay this prompt\r\n${'answer\r\n'.repeat(15)}`)
    expect(history.canAttemptJump()).toBe(true)
    expect(history.currentLine(true)).toBe(1)
  })

  it('anchors delayed status to the full wrapped multiline prompt instead of response output', async () => {
    const { history, write } = fixture()
    const prompt = `Please explain ${'wrapped prompt text '.repeat(6)}\nThen add coverage.`
    await write(`startup\r\n> ${prompt.replace('\n', '\r\n')}\r\n${'answer\r\n'.repeat(15)}`)
    history.acceptStatus({ prompt, turnStartedAt: 1 })
    expect(history.currentLine()).toBe(1)
  })

  it('refines an early status marker on click after prompt output arrives', async () => {
    const { history, write } = fixture()
    history.acceptStatus({ prompt: 'Find the actual message', turnStartedAt: 1 })
    await write(`status decoration\r\n> Find the actual message\r\n${'answer\r\n'.repeat(12)}`)
    expect(history.currentLine()).toBe(0)
    expect(history.currentLine(true)).toBe(1)
    expect(history.currentLine()).toBe(1)
  })

  it('keeps the fallback for ambiguous matches and separates repeated identical turns', async () => {
    const { terminal, history, write } = fixture()
    await write(`> repeat this\r\nquoted: repeat this\r\n${'answer\r\n'.repeat(10)}`)
    history.acceptStatus({ prompt: 'repeat this', turnStartedAt: 1 })
    expect(history.currentLine()).toBe(
      terminal.buffer.active.baseY + terminal.buffer.active.cursorY
    )
    history.dispose()
    terminal.reset()
    await write(`> repeat this\r\n${'answer\r\n'.repeat(10)}`)
    history.acceptStatus({ prompt: 'repeat this', turnStartedAt: 1 })
    expect(history.currentLine()).toBe(0)
    await write(`> repeat this\r\n${'answer\r\n'.repeat(10)}`)
    history.acceptStatus({ prompt: 'repeat this', turnStartedAt: 2 })
    expect(history.currentLine()).toBe(11)
  })

  it('recovers a restored prompt position only from unique buffer text', async () => {
    const { history, write } = fixture()
    await write(`startup\r\n> Recover this prompt\r\n${'answer\r\n'.repeat(10)}`)
    history.acceptStatus({ prompt: 'Recover this prompt', restoredUnconfirmed: true }, false)
    expect(history.currentLine()).toBe(1)
  })

  it('selects earlier turns when scrolled back and the current turn at the bottom', async () => {
    const { terminal, history, write } = fixture()
    expect(history.current()).toBeNull()
    history.acceptStatus({ prompt: 'first', turnStartedAt: 1 })
    await write('first output\r\n'.repeat(12))
    history.acceptStatus({ prompt: 'second', turnStartedAt: 2 })
    expect(history.current()).toBe('second')
    await write('second output\r\n'.repeat(12))
    terminal.scrollToLine(4)
    expect(history.current()).toBe('first')
    terminal.scrollToLine(14)
    expect(history.current()).toBe('second')
    terminal.scrollToBottom()
    expect(history.current()).toBe('second')
  })

  it('deduplicates tool updates but anchors identical prompts in distinct turns', async () => {
    const { terminal, history, write } = fixture()
    history.acceptStatus({ prompt: 'again', promptInteractionKey: 'one' })
    await write('output\r\n'.repeat(12))
    history.acceptStatus({ prompt: 'again', promptInteractionKey: 'one' })
    expect(terminal.markers).toHaveLength(1)
    history.acceptStatus({ prompt: 'again', promptInteractionKey: 'two' })
    expect(terminal.markers).toHaveLength(2)
    history.dispose()
    expect(terminal.markers).toHaveLength(0)
  })

  it('shows no future prompt above its anchor and avoids inventing replay positions', async () => {
    const { terminal, history, write } = fixture()
    await write('startup\r\n'.repeat(12))
    history.acceptStatus({ prompt: 'restored', restoredUnconfirmed: true })
    expect(history.current()).toBe('restored')
    terminal.scrollToLine(0)
    expect(history.current()).toBeNull()
    history.acceptStatus({ prompt: 'live', turnStartedAt: 2 })
    expect(history.current()).toBeNull()
  })

  it('drops erased markers and caps retained history', async () => {
    const { terminal, history, write } = fixture(10)
    history.acceptStatus({ prompt: 'old', turnStartedAt: 1 })
    await write('output\r\n'.repeat(30))
    expect(history.current()).toBe('old')
    terminal.scrollToLine(0)
    expect(history.current()).toBeNull()
    expect(history.hasPrompts()).toBe(true)
    for (let turn = 0; turn < 220; turn++) {
      history.acceptStatus({ prompt: String(turn), turnStartedAt: turn })
    }
    expect(terminal.markers).toHaveLength(200)
    history.acceptStatus(undefined)
    expect(history.hasPrompts()).toBe(true)
    history.acceptStatus({ prompt: '', sessionBoundary: true })
    expect(history.hasPrompts()).toBe(true)
    history.dispose()
    expect(terminal.markers).toHaveLength(0)
    expect(history.current()).toBeNull()
  })

  it('keeps panes isolated and uses only latest context in alternate screen', async () => {
    const a = fixture()
    const b = fixture()
    a.history.acceptStatus({ prompt: 'A' })
    b.history.acceptStatus({ prompt: 'B' })
    await a.write('\u001b[?1049h')
    a.history.acceptStatus({ prompt: 'alternate turn', turnStartedAt: 2 })
    expect(a.history.current()).toBe('alternate turn')
    expect(b.history.current()).toBe('B')
    await a.write('\u001b[?1049l')
    a.history.acceptStatus({ prompt: 'ended', sessionBoundary: true })
    expect(a.history.current()).toBe('alternate turn')
  })
})
