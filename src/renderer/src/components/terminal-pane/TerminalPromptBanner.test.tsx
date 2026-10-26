// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import { TerminalPromptBanner } from './TerminalPromptBanner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import { TerminalPromptHistory } from '../../../../shared/terminal-prompt-history'

const useAppStore = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn() }))
const subscribeTranscript = vi.hoisted(() => vi.fn())
vi.mock('../native-chat/native-chat-session-transport', () => ({
  getNativeChatSessionTransport: () => ({ subscribe: subscribeTranscript })
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  runtimeEnvironmentIdWithLegacyFallbackUnlessTwin: () => null
}))
vi.mock('@/store', () => ({ useAppStore }))
const idleQueue = vi.hoisted(() => new Set<() => void>())
vi.mock('@/lib/input-quiet-scheduler', () => ({
  scheduleAfterInputQuiet: (callback: () => void) => {
    idleQueue.add(callback)
    return () => idleQueue.delete(callback)
  }
}))
const runIdle = (): void =>
  act(() => {
    const pending = [...idleQueue]
    idleQueue.clear()
    for (const callback of pending) {
      callback()
    }
  })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
  subscribeTranscript.mockReset()
  idleQueue.clear()
  useAppStore.subscribe.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps its reserved row above unknown history and releases listeners on unmount', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(28)
  vi.mocked(useAppStore.getState).mockReturnValue({ agentStatusByPaneKey: {} })
  const unsubscribe = vi.fn()
  vi.mocked(useAppStore.subscribe).mockReturnValue(unsubscribe)
  const host = document.createElement('div')
  const container = document.createElement('div')
  document.body.append(host, container)
  const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true })
  const root = createRoot(host)
  const leafId = '327e0194-4617-4b8b-aa67-05abe97c93bc'
  if (!isTerminalLeafId(leafId)) {
    throw new Error('Invalid fixture leaf')
  }
  cleanup.push(() => {
    terminal.dispose()
    host.remove()
    container.remove()
  })
  await act(async () => {
    root.render(
      <TooltipProvider>
        <TerminalPromptBanner pane={{ leafId, terminal, container }} tabId="tab" visible active />
      </TooltipProvider>
    )
  })
  expect(container.querySelector('[data-terminal-prompt-banner]')).toBeNull()
  const state = {
    agentStatusByPaneKey: { 'tab:327e0194-4617-4b8b-aa67-05abe97c93bc': { prompt: 'Known prompt' } }
  }
  vi.mocked(useAppStore.getState).mockReturnValue(state)
  const refreshes = vi.spyOn(TerminalPromptHistory.prototype, 'refreshPositions')
  await act(async () => {
    const listener = vi.mocked(useAppStore.subscribe).mock.calls[0][0]
    listener(state, { agentStatusByPaneKey: {} })
    await new Promise<void>((resolve) => terminal.write('output\r\n'.repeat(20), resolve))
  })
  // Status and per-line output events share one idle refresh; none runs inline.
  expect(refreshes).not.toHaveBeenCalled()
  runIdle()
  expect(refreshes).toHaveBeenCalledOnce()
  const banner = container.querySelector('[data-terminal-prompt-banner]')
  const scroll = vi.spyOn(terminal, 'scrollToLine')
  act(() => container.querySelector('button')?.click())
  expect(scroll).toHaveBeenCalledWith(0)
  expect(banner?.textContent).toContain('Known prompt')
  // The first anchor is at row zero; erase its position without erasing the prompt.
  await act(async () => {
    await new Promise<void>((resolve) => terminal.write('\u001b[3J', resolve))
    terminal.scrollToLine(0)
  })
  runIdle()
  expect(container.querySelector('[data-terminal-prompt-banner]')).toBe(banner)
  expect(container.style.getPropertyValue('--orca-pane-top-banner-height')).toBe('28px')
  act(() => root.unmount())
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(container.style.getPropertyValue('--orca-pane-top-banner-height')).toBe('')
})

it('does no banner upkeep while its tab is hidden and catches up once shown', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  const leafId = '327e0194-4617-4b8b-aa67-05abe97c93bc'
  if (!isTerminalLeafId(leafId)) {
    throw new Error('Invalid fixture leaf')
  }
  const state = { agentStatusByPaneKey: { [`tab:${leafId}`]: { prompt: 'Hidden prompt' } } }
  useAppStore.getState.mockReturnValue(state)
  useAppStore.subscribe.mockReturnValue(vi.fn())
  const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true })
  const host = document.createElement('div')
  const container = document.createElement('div')
  document.body.append(host, container)
  const root = createRoot(host)
  cleanup.push(() => {
    act(() => root.unmount())
    terminal.dispose()
    host.remove()
    container.remove()
  })
  const render = (active: boolean): void =>
    root.render(
      <TooltipProvider>
        <TerminalPromptBanner
          pane={{ leafId, terminal, container }}
          tabId="tab"
          visible
          active={active}
        />
      </TooltipProvider>
    )
  const refreshes = vi.spyOn(TerminalPromptHistory.prototype, 'refreshPositions')
  await act(async () => {
    render(false)
    await new Promise<void>((resolve) => terminal.write('output\r\n'.repeat(20), resolve))
  })
  runIdle()
  expect(refreshes).not.toHaveBeenCalled()
  expect(container.querySelector('[data-terminal-prompt-banner]')).toBeNull()
  act(() => render(true))
  runIdle()
  expect(refreshes).toHaveBeenCalledOnce()
  expect(container.querySelector('[data-terminal-prompt-banner]')?.textContent).toContain(
    'Hidden prompt'
  )
})

it.each(['pi', 'claude', 'codex'])(
  'loads %s transcript prompts and changes the banner when scrolling through earlier turns',
  async (agent) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      }
    )
    const leafId = '327e0194-4617-4b8b-aa67-05abe97c93bc'
    if (!isTerminalLeafId(leafId)) {
      throw new Error('Invalid fixture leaf')
    }
    useAppStore.getState.mockReturnValue({
      agentStatusByPaneKey: {
        [`tab:${leafId}`]: {
          agentType: agent,
          prompt: 'Newest prompt',
          worktreeId: 'workspace',
          providerSession: {
            id: `${agent}-session`,
            transcriptPath: `/host/${agent}-session.jsonl`
          }
        }
      }
    })
    useAppStore.subscribe.mockReturnValue(vi.fn())
    const unsubscribeTranscript = vi.fn()
    subscribeTranscript.mockImplementation((_args, onFrame) => {
      onFrame({ type: 'snapshot', messages: [], pending: true })
      return unsubscribeTranscript
    })
    const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true })
    const host = document.createElement('div')
    const container = document.createElement('div')
    document.body.append(host, container)
    const root = createRoot(host)
    cleanup.push(() => {
      act(() => root.unmount())
      terminal.dispose()
      host.remove()
      container.remove()
    })
    await act(async () => {
      await new Promise<void>((resolve) =>
        terminal.write(
          `> Earlier prompt\r\n${'old output\r\n'.repeat(15)}> Newest prompt\r\n${'new output\r\n'.repeat(15)}`,
          resolve
        )
      )
      root.render(
        <TooltipProvider>
          <TerminalPromptBanner pane={{ leafId, terminal, container }} tabId="tab" visible active />
        </TooltipProvider>
      )
    })
    runIdle()
    act(() => {
      subscribeTranscript.mock.calls[0][1]({
        type: 'snapshot',
        messages: [
          { id: 'old', role: 'user', blocks: [{ type: 'text', text: 'Earlier prompt' }] },
          { id: 'new', role: 'user', blocks: [{ type: 'text', text: 'Newest prompt' }] }
        ]
      })
    })
    runIdle()
    const banner = container.querySelector('[data-terminal-prompt-banner]')
    expect(subscribeTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        agent,
        sessionId: `${agent}-session`,
        limit: 200,
        transcriptPath: `/host/${agent}-session.jsonl`
      }),
      expect.any(Function)
    )
    expect(banner?.textContent).toContain('Newest prompt')
    act(() => terminal.scrollToLine(5))
    runIdle()
    expect(banner?.textContent).toContain('Earlier prompt')
    act(() => terminal.scrollToLine(20))
    runIdle()
    expect(banner?.textContent).toContain('Newest prompt')
    act(() => terminal.scrollToLine(5))
    runIdle()
    act(() => container.querySelector('button')?.click())
    expect(terminal.buffer.active.viewportY).toBe(0)
    expect(banner?.textContent).toContain('Earlier prompt')
    act(() => terminal.scrollToBottom())
    runIdle()
    expect(banner?.textContent).toContain('Newest prompt')
    await act(async () => {
      await new Promise<void>((resolve) =>
        terminal.write('❯ Prompt arriving after session start\r\n', resolve)
      )
      subscribeTranscript.mock.calls[0][1]({
        type: 'appended',
        messages: [
          {
            id: 'late',
            role: 'user',
            blocks: [{ type: 'text', text: 'Prompt arriving after session start' }]
          }
        ]
      })
    })
    runIdle()
    expect(banner?.textContent).toContain('Prompt arriving after session start')
    act(() => root.unmount())
    expect(unsubscribeTranscript).toHaveBeenCalledOnce()
    cleanup.pop()
    terminal.dispose()
    host.remove()
    container.remove()
  }
)
