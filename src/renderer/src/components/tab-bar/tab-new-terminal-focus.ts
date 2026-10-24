import { useAppStore } from '../../store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'

const TERMINAL_FOCUS_RETRY_MS = 50
const TERMINAL_FOCUS_TIMEOUT_MS = 5000

export function focusNewActiveTerminalWhenReady(
  previousActiveTabId: string | null,
  expiresAt: number,
  now: number,
  scheduleRetry: (callback: () => void, delay: number) => void
): void {
  const state = useAppStore.getState()
  if (
    (state.activeTabType === 'terminal' || state.activeTabType === 'simulator') &&
    state.activeTabId &&
    state.activeTabId !== previousActiveTabId
  ) {
    focusTerminalTabSurface(state.activeTabId)
    return
  }
  if (now >= expiresAt) {
    return
  }
  scheduleRetry(() => {
    focusNewActiveTerminalWhenReady(previousActiveTabId, expiresAt, Date.now(), scheduleRetry)
  }, TERMINAL_FOCUS_RETRY_MS)
}

export function focusNewActiveTerminalAfterDelay(
  previousActiveTabId: string | null,
  scheduleRetry: (callback: () => void, delay: number) => void
): void {
  focusNewActiveTerminalWhenReady(
    previousActiveTabId,
    Date.now() + TERMINAL_FOCUS_TIMEOUT_MS,
    Date.now(),
    scheduleRetry
  )
}
