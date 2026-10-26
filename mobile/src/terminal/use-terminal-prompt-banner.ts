import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import {
  TerminalPromptHistory,
  terminalPromptHistory
} from '../../../src/shared/terminal-prompt-history'
import {
  hasTerminalPromptTranscript,
  terminalTranscriptPrompts
} from '../../../src/shared/terminal-transcript-prompts'
import {
  createTerminalPromptRefreshGate,
  type TerminalPromptRefreshScheduler
} from '../../../src/shared/terminal-prompt-refresh-gate'
import type { RpcClient } from '../transport/rpc-client'
import { nativeChatSessionPageRead } from '../session/mobile-session-read-operations'

// Safari has no requestIdleCallback, so a short timer stands in for idle time there.
const scheduleIdleRefresh: TerminalPromptRefreshScheduler = (run) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 250 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 50)
  return () => clearTimeout(id)
}

type PromptTerminal = Pick<
  Terminal,
  'buffer' | 'registerMarker' | 'onScroll' | 'onWriteParsed' | 'scrollToLine'
>

export function useTerminalPromptBanner(
  status: AgentStatusEntry | null | undefined,
  client?: RpcClient | null,
  active = true
) {
  const current = useRef<{
    terminal: PromptTerminal
    history: TerminalPromptHistory
    dispose: () => void
  } | null>(null)
  const statusRef = useRef(status)
  const seededRef = useRef<ReturnType<typeof terminalTranscriptPrompts>>([])
  const [context, setContext] = useState({ text: '', known: false, jumpable: false })
  const update = useCallback(() => {
    const history = current.current?.history
    history?.refreshPositions()
    const text = history?.current() ?? ''
    const known = history?.hasPrompts() ?? false
    const jumpable = history?.canAttemptJump() ?? false
    setContext((previous) =>
      previous.text === text && previous.known === known && previous.jumpable === jumpable
        ? previous
        : { text, known, jumpable }
    )
  }, [])
  const [gate] = useState(() =>
    createTerminalPromptRefreshGate(update, scheduleIdleRefresh, active)
  )
  const refresh = gate.request
  useEffect(() => {
    gate.setActive(active)
    // Pausing rather than disposing survives StrictMode's effect replay on the same instance.
    return () => gate.setActive(false)
  }, [gate, active])
  const attach = useCallback(
    (terminal: PromptTerminal) => {
      current.current?.dispose()
      const history = terminalPromptHistory(terminal)
      history.acceptStatus(statusRef.current ?? undefined, false)
      history.seedPrompts(seededRef.current)
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
  const agent = status?.agentType
  const sessionId = status?.providerSession?.id
  const transcriptPath = status?.providerSession?.transcriptPath
  useEffect(() => {
    seededRef.current = []
    if (!client || !agent || !sessionId || !hasTerminalPromptTranscript(agent)) {
      return
    }
    let cancelled = false
    void nativeChatSessionPageRead
      .request(client, { agent, sessionId, transcriptPath, limit: 200 })
      .then((response) => {
        const accepted = nativeChatSessionPageRead.interpret(response)
        const value = accepted.accepted ? accepted.value : null
        if (
          !cancelled &&
          value &&
          typeof value === 'object' &&
          'messages' in value &&
          Array.isArray(value.messages)
        ) {
          seededRef.current = terminalTranscriptPrompts(value.messages)
          current.current?.history.seedPrompts(seededRef.current)
          refresh()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, agent, sessionId, transcriptPath, refresh])
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
      update()
    }
  }, [update])
  return { ...context, attach, detach, jump }
}
