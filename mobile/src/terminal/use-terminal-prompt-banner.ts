import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { TerminalPromptHistory } from '../../../src/shared/terminal-prompt-history'

type PromptTerminal = Pick<
  Terminal,
  'buffer' | 'registerMarker' | 'onScroll' | 'onWriteParsed' | 'scrollToLine'
>

export function useTerminalPromptBanner(status: AgentStatusEntry | null | undefined) {
  const current = useRef<{
    terminal: PromptTerminal
    history: TerminalPromptHistory
    dispose: () => void
  } | null>(null)
  const statusRef = useRef(status)
  const [context, setContext] = useState({ text: '', known: false, jumpable: false })
  const refresh = useCallback(() => {
    const history = current.current?.history
    const text = history?.current() ?? ''
    const known = history?.hasPrompts() ?? false
    const jumpable = history?.canAttemptJump() ?? false
    setContext((previous) =>
      previous.text === text && previous.known === known && previous.jumpable === jumpable
        ? previous
        : { text, known, jumpable }
    )
  }, [])
  const attach = useCallback(
    (terminal: PromptTerminal) => {
      current.current?.dispose()
      const history = new TerminalPromptHistory(terminal)
      history.acceptStatus(statusRef.current ?? undefined, false)
      const scroll = terminal.onScroll(refresh)
      const parsed = terminal.onWriteParsed(refresh)
      const buffer = terminal.buffer.onBufferChange(refresh)
      current.current = {
        terminal,
        history,
        dispose: () => {
          scroll.dispose()
          parsed.dispose()
          buffer.dispose()
          history.dispose()
        }
      }
      refresh()
    },
    [refresh]
  )
  useEffect(() => {
    statusRef.current = status
    current.current?.history.acceptStatus(status ?? undefined)
    refresh()
  }, [status, refresh])
  const detach = useCallback(() => {
    current.current?.dispose()
    current.current = null
  }, [])
  useEffect(() => detach, [detach])
  const jump = useCallback(() => {
    const active = current.current
    const line = active?.history.currentLine(true)
    if (active && line !== null && line !== undefined) {
      active.terminal.scrollToLine(line)
      refresh()
    }
  }, [refresh])
  return { ...context, attach, detach, jump }
}
