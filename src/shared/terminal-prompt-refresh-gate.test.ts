import { expect, it, vi } from 'vitest'
import { createTerminalPromptRefreshGate } from './terminal-prompt-refresh-gate'

function manualScheduler() {
  const pending = new Set<() => void>()
  return {
    schedule: (run: () => void) => {
      pending.add(run)
      return () => pending.delete(run)
    },
    flush: () => {
      const runs = [...pending]
      pending.clear()
      runs.forEach((run) => run())
    },
    get size() {
      return pending.size
    }
  }
}

it('coalesces a burst of requests into one deferred refresh', () => {
  const refresh = vi.fn()
  const scheduler = manualScheduler()
  const gate = createTerminalPromptRefreshGate(refresh, scheduler.schedule)
  for (let line = 0; line < 500; line++) {
    gate.request()
  }
  expect(refresh).not.toHaveBeenCalled()
  expect(scheduler.size).toBe(1)
  scheduler.flush()
  expect(refresh).toHaveBeenCalledOnce()
  gate.request()
  scheduler.flush()
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('does nothing while inactive and catches up once when activated', () => {
  const refresh = vi.fn()
  const scheduler = manualScheduler()
  const gate = createTerminalPromptRefreshGate(refresh, scheduler.schedule, false)
  gate.request()
  expect(scheduler.size).toBe(0)
  gate.setActive(true)
  scheduler.flush()
  expect(refresh).toHaveBeenCalledOnce()
})

it('drops a pending refresh when deactivated, paused or disposed', () => {
  const refresh = vi.fn()
  const scheduler = manualScheduler()
  const gate = createTerminalPromptRefreshGate(refresh, scheduler.schedule)
  gate.request()
  gate.setActive(false)
  expect(scheduler.size).toBe(0)
  gate.setActive(true)
  gate.dispose()
  expect(scheduler.size).toBe(0)
  gate.request()
  gate.setActive(true)
  scheduler.flush()
  expect(refresh).not.toHaveBeenCalled()
})
