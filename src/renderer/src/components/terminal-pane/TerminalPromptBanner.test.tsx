// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import { TerminalPromptBanner } from './TerminalPromptBanner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isTerminalLeafId } from '../../../../shared/stable-pane-id'

const useAppStore = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn() }))
const readSession = vi.hoisted(() => vi.fn())
vi.mock('../native-chat/native-chat-session-transport', () => ({
  getNativeChatSessionTransport: () => ({ readSession })
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  runtimeEnvironmentIdWithLegacyFallbackUnlessTwin: () => null
}))
vi.mock('@/store', () => ({ useAppStore }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
  readSession.mockReset()
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
        <TerminalPromptBanner pane={{ leafId, terminal, container }} tabId="tab" visible />
      </TooltipProvider>
    )
  })
  expect(container.querySelector('[data-terminal-prompt-banner]')).toBeNull()
  const state = {
    agentStatusByPaneKey: { 'tab:327e0194-4617-4b8b-aa67-05abe97c93bc': { prompt: 'Known prompt' } }
  }
  vi.mocked(useAppStore.getState).mockReturnValue(state)
  await act(async () => {
    const listener = vi.mocked(useAppStore.subscribe).mock.calls[0][0]
    listener(state, { agentStatusByPaneKey: {} })
    await new Promise<void>((resolve) => terminal.write('output\r\n'.repeat(20), resolve))
  })
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
  expect(container.querySelector('[data-terminal-prompt-banner]')).toBe(banner)
  expect(container.style.getPropertyValue('--orca-pane-top-banner-height')).toBe('28px')
  act(() => root.unmount())
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(container.style.getPropertyValue('--orca-pane-top-banner-height')).toBe('')
})

it('loads Pi transcript prompts and changes the banner when scrolling through earlier turns', async () => {
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
        agentType: 'pi',
        prompt: 'Newest prompt',
        worktreeId: 'workspace',
        providerSession: { id: 'pi-session', transcriptPath: '/host/pi-session.jsonl' }
      }
    }
  })
  useAppStore.subscribe.mockReturnValue(vi.fn())
  readSession.mockResolvedValue({
    messages: [
      { id: 'old', role: 'user', blocks: [{ type: 'text', text: 'Earlier prompt' }] },
      { id: 'new', role: 'user', blocks: [{ type: 'text', text: 'Newest prompt' }] }
    ]
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
        <TerminalPromptBanner pane={{ leafId, terminal, container }} tabId="tab" visible />
      </TooltipProvider>
    )
  })
  const banner = container.querySelector('[data-terminal-prompt-banner]')
  expect(readSession).toHaveBeenCalledWith('pi', 'pi-session', 200, '/host/pi-session.jsonl')
  expect(banner?.textContent).toContain('Newest prompt')
  act(() => terminal.scrollToLine(5))
  expect(banner?.textContent).toContain('Earlier prompt')
  act(() => terminal.scrollToLine(20))
  expect(banner?.textContent).toContain('Newest prompt')
  act(() => terminal.scrollToLine(5))
  act(() => container.querySelector('button')?.click())
  expect(terminal.buffer.active.viewportY).toBe(0)
  expect(banner?.textContent).toContain('Earlier prompt')
  act(() => terminal.scrollToBottom())
  expect(banner?.textContent).toContain('Newest prompt')
})
