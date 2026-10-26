import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { TerminalPromptStatus } from '../../../src/shared/terminal-prompt-history'
import {
  hasTerminalPromptTranscript,
  terminalTranscriptPrompts
} from '../../../src/shared/terminal-transcript-prompts'
import type { RpcClient } from '../transport/rpc-client'
import { nativeChatSessionPageRead } from '../session/mobile-session-read-operations'
import type { TerminalWebViewCommand } from './terminal-webview-messages'

export type TerminalPromptContext = { text: string; known: boolean; jumpable: boolean }

const EMPTY_CONTEXT: TerminalPromptContext = { text: '', known: false, jumpable: false }

/**
 * The banner's host half. The terminal document owns the prompt history, because it owns the
 * terminal (inside the WebView on a phone); this feeds it status and transcript prompts and keeps
 * the context it reports back.
 */
export function useTerminalPromptBanner(
  status: AgentStatusEntry | null | undefined,
  client: RpcClient | null | undefined,
  active: boolean,
  post: (command: TerminalWebViewCommand) => void
) {
  const [context, setContext] = useState(EMPTY_CONTEXT)
  // Only what the banner reads crosses the bridge, and only when one of those fields changes.
  const hasStatus = status !== null && status !== undefined
  const prompt = status?.prompt
  const promptInteractionKey = status?.promptInteractionKey
  const turnStartedAt = status?.turnStartedAt
  const restoredUnconfirmed = status?.restoredUnconfirmed
  const sessionBoundary = status?.sessionBoundary
  const promptStatus = useMemo<TerminalPromptStatus | null>(
    () =>
      hasStatus
        ? {
            prompt: prompt ?? '',
            promptInteractionKey,
            turnStartedAt,
            restoredUnconfirmed,
            sessionBoundary
          }
        : null,
    [hasStatus, prompt, promptInteractionKey, turnStartedAt, restoredUnconfirmed, sessionBoundary]
  )
  const seedsRef = useRef<ReturnType<typeof terminalTranscriptPrompts>>([])
  const latestRef = useRef<{ status: TerminalPromptStatus | null; active: boolean }>({
    status: null,
    active
  })

  useEffect(() => {
    latestRef.current.status = promptStatus
    post({ type: 'prompt-status', status: promptStatus })
  }, [post, promptStatus])
  useEffect(() => {
    latestRef.current.active = active
    post({ type: 'prompt-active', active })
  }, [post, active])

  const agent = status?.agentType
  const sessionId = status?.providerSession?.id
  const transcriptPath = status?.providerSession?.transcriptPath
  useEffect(() => {
    seedsRef.current = []
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
          seedsRef.current = terminalTranscriptPrompts(value.messages)
          post({ type: 'prompt-seeds', prompts: seedsRef.current })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, agent, sessionId, transcriptPath, post])

  /** A fresh document knows nothing; readiness hands it everything again. */
  const replay = useCallback((send: (command: TerminalWebViewCommand) => void) => {
    const latest = latestRef.current
    send({ type: 'prompt-status', status: latest.status })
    if (seedsRef.current.length > 0) {
      send({ type: 'prompt-seeds', prompts: seedsRef.current })
    }
    send({ type: 'prompt-active', active: latest.active })
  }, [])

  /** Takes the document's `prompt-context` notify; answers whether it was one. */
  const receive = useCallback((msg: Record<string, unknown>) => {
    if (msg.type !== 'prompt-context') {
      return false
    }
    const next = {
      text: typeof msg.text === 'string' ? msg.text : '',
      known: msg.known === true,
      jumpable: msg.jumpable === true
    }
    setContext((previous) =>
      previous.text === next.text &&
      previous.known === next.known &&
      previous.jumpable === next.jumpable
        ? previous
        : next
    )
    return true
  }, [])

  const jump = useCallback(() => post({ type: 'prompt-jump' }), [post])

  return { context, replay, receive, jump }
}
