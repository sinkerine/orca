import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTerminalDocumentScope } from './document-scope'
import {
  attachPromptBanner,
  jumpToPrompt,
  seedPrompts,
  setPromptActive,
  setPromptStatus,
  stopPromptBanner
} from './prompt-banner'

const idle = new Set<() => void>()

beforeEach(() => {
  vi.stubGlobal('requestIdleCallback', (run: () => void) => {
    idle.add(run)
    return idle.size
  })
  vi.stubGlobal('cancelIdleCallback', () => idle.clear())
})

afterEach(() => {
  idle.clear()
  vi.unstubAllGlobals()
})

function runIdle() {
  const runs = [...idle]
  idle.clear()
  runs.forEach((run) => run())
}

/** xterm's members the banner reads, at the live bottom of an empty normal buffer. */
function promptTerminal() {
  const listeners: (() => void)[] = []
  const subscribe = (listener: () => void) => {
    listeners.push(listener)
    return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) }
  }
  return {
    listeners,
    terminal: {
      buffer: {
        active: {
          type: 'normal',
          length: 0,
          baseY: 0,
          cursorY: 0,
          viewportY: 0,
          getLine: () => undefined
        },
        onBufferChange: subscribe
      },
      registerMarker: () => ({ line: 0, isDisposed: false, dispose: () => {} }),
      onScroll: subscribe,
      onWriteParsed: subscribe,
      scrollToLine: vi.fn()
    }
  }
}

function documentScope() {
  const posted: Record<string, unknown>[] = []
  const scope = createTerminalDocumentScope({ postToHost: (message) => posted.push(message) })
  return { scope, posted }
}

it('reports the prompt once per idle period however much output arrives', () => {
  const { scope, posted } = documentScope()
  const { terminal, listeners } = promptTerminal()
  attachPromptBanner(scope, terminal)
  setPromptStatus(scope, { prompt: 'Fix the inbox flow', agentType: 'pi', stateHistory: [] })
  for (let line = 0; line < 500; line++) {
    listeners.forEach((listener) => listener())
  }
  expect(posted).toEqual([])
  runIdle()
  expect(posted).toEqual([
    { type: 'prompt-context', text: 'Fix the inbox flow', known: true, jumpable: true }
  ])
  runIdle()
  expect(posted).toHaveLength(1)
})

it('does no upkeep while hidden and catches up when shown', () => {
  const { scope, posted } = documentScope()
  const { terminal } = promptTerminal()
  setPromptActive(scope, false)
  attachPromptBanner(scope, terminal)
  seedPrompts(scope, [{ id: 'one', text: 'Seeded prompt' }], false)
  runIdle()
  expect(posted).toEqual([])
  setPromptActive(scope, true)
  runIdle()
  expect(posted.at(-1)).toMatchObject({ type: 'prompt-context', text: 'Seeded prompt' })
})

it('jumps to a live prompt and carries it to a replacement terminal', () => {
  const { scope, posted } = documentScope()
  const first = promptTerminal().terminal
  attachPromptBanner(scope, first)
  setPromptStatus(scope, { prompt: 'Kept across re-init' })
  jumpToPrompt(scope)
  expect(first.scrollToLine).toHaveBeenCalledWith(0)
  attachPromptBanner(scope, promptTerminal().terminal)
  runIdle()
  expect(posted.at(-1)).toMatchObject({ type: 'prompt-context', text: 'Kept across re-init' })
  stopPromptBanner(scope)
  expect(scope.promptBanner).toBeNull()
})

it('leaves an engine without markers bannerless', () => {
  const { scope, posted } = documentScope()
  attachPromptBanner(scope, { buffer: { active: {} } })
  setPromptStatus(scope, { prompt: 'Nowhere to anchor' })
  runIdle()
  expect(posted.at(-1)).toBeUndefined()
})
