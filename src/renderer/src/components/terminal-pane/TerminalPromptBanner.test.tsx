// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import { TerminalPromptBanner } from './TerminalPromptBanner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { isTerminalLeafId } from '../../../../shared/stable-pane-id'

const useAppStore = vi.hoisted(() => ({ getState: vi.fn(), subscribe: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
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
