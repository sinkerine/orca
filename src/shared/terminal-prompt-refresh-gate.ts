/** Schedules `run` later and returns a cancel function. */
export type TerminalPromptRefreshScheduler = (run: () => void) => () => void

export type TerminalPromptRefreshGate = {
  /** Arms at most one deferred refresh; a no-op while one is pending or the terminal is inactive. */
  request: () => void
  /** Inactive terminals defer all upkeep; becoming active catches up with one refresh. */
  setActive: (active: boolean) => void
  dispose: () => void
}

/**
 * The prompt banner is advisory, so its upkeep never runs inline with terminal output: xterm fires
 * onScroll per line feed, and each listener call only arms one deferred refresh.
 */
export function createTerminalPromptRefreshGate(
  refresh: () => void,
  schedule: TerminalPromptRefreshScheduler,
  active = true
): TerminalPromptRefreshGate {
  let cancel: (() => void) | null = null
  let disposed = false
  const request = (): void => {
    if (cancel || !active || disposed) {
      return
    }
    cancel = schedule(() => {
      cancel = null
      if (!disposed) {
        refresh()
      }
    })
  }
  return {
    request,
    setActive: (next) => {
      active = next
      if (active) {
        request()
      } else {
        cancel?.()
        cancel = null
      }
    },
    dispose: () => {
      disposed = true
      cancel?.()
      cancel = null
    }
  }
}
