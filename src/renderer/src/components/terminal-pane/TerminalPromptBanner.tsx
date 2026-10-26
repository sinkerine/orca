import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { useReservePaneTopSpace } from './PaneTopWarningBanner'
import type { TerminalPromptHistory } from '../../../../shared/terminal-prompt-history'
import { terminalPromptHistory } from '../../../../shared/terminal-prompt-history'
import {
  hasTerminalPromptTranscript,
  terminalTranscriptPrompts
} from '../../../../shared/terminal-transcript-prompts'
import { getNativeChatSessionTransport } from '../native-chat/native-chat-session-transport'
import { runtimeEnvironmentIdWithLegacyFallbackUnlessTwin } from '@/lib/worktree-runtime-owner'
import { createUuidV4 } from '../../../../shared/uuid-v4'
import { scheduleAfterInputQuiet } from '@/lib/input-quiet-scheduler'
import {
  createTerminalPromptRefreshGate,
  type TerminalPromptRefreshGate
} from '../../../../shared/terminal-prompt-refresh-gate'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type PromptContext = { text: string | null; known: boolean; jumpable: boolean }
// The banner is advisory; its upkeep waits for idle time so it never competes with output or paint.
const REFRESH_SCHEDULE = { delayMs: 0, quietMs: 0, idleTimeoutMs: 250 }

function PromptStrip({
  context,
  onJump
}: {
  context: PromptContext
  onJump: () => void
}): React.JSX.Element {
  const ref = useReservePaneTopSpace()
  return (
    <div
      ref={ref}
      data-terminal-prompt-banner
      className="pane-top-banner flex min-w-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5 pr-16 text-xs text-foreground"
    >
      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {context.text ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="min-w-0 flex-1 justify-start"
              aria-disabled={!context.jumpable}
              onClick={onJump}
            >
              <span className="truncate">{context.text.replace(/\s+/g, ' ')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-lg whitespace-pre-wrap">
            {context.text}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-muted-foreground">
          {translate('terminal.promptBanner.unknown', 'No prompt recorded at this position')}
        </span>
      )}
    </div>
  )
}

export function TerminalPromptBanner({
  pane,
  tabId,
  visible,
  active
}: {
  pane: {
    terminal: Pick<
      ManagedPane['terminal'],
      'buffer' | 'registerMarker' | 'onScroll' | 'onWriteParsed' | 'scrollToLine'
    >
    container: HTMLElement
    leafId: ManagedPane['leafId']
  }
  tabId: string
  visible: boolean
  /** Hidden tabs defer all banner upkeep until they are shown again. */
  active: boolean
}): React.JSX.Element | null {
  const historyRef = useRef<TerminalPromptHistory | null>(null)
  const activeRef = useRef(active)
  const gateRef = useRef<TerminalPromptRefreshGate | null>(null)
  const [context, setContext] = useState<PromptContext>({
    text: null,
    known: false,
    jumpable: false
  })
  // oxlint-disable-next-line react-doctor/effect-needs-cleanup -- Both subscriptions are disposed below; transcript ownership changes inside acceptStatus.
  useEffect(() => {
    const history = terminalPromptHistory(pane.terminal)
    let disposed = false
    let transcriptIdentity = ''
    let unsubscribeTranscript: (() => void) | undefined
    historyRef.current = history
    const paneKey = makePaneKey(tabId, pane.leafId)
    const refresh = (): void => {
      history.refreshPositions()
      const text = history.current()
      const known = history.hasPrompts()
      const jumpable = history.canAttemptJump()
      setContext((previous) =>
        previous.text === text && previous.known === known && previous.jumpable === jumpable
          ? previous
          : { text, known, jumpable }
      )
    }
    const acceptStatus = (live: boolean): void => {
      const state = useAppStore.getState()
      const status = state.agentStatusByPaneKey[paneKey]
      history.acceptStatus(status, live)
      scheduleRefresh()
      const provider = status?.providerSession
      const agent = status?.agentType
      const identity = JSON.stringify([agent, provider?.id, provider?.transcriptPath])
      if (
        provider?.id &&
        agent &&
        hasTerminalPromptTranscript(agent) &&
        identity !== transcriptIdentity
      ) {
        unsubscribeTranscript?.()
        transcriptIdentity = identity
        const transport = getNativeChatSessionTransport(
          runtimeEnvironmentIdWithLegacyFallbackUnlessTwin(state, status.worktreeId)
        )
        unsubscribeTranscript = transport.subscribe(
          {
            subscriptionId: `terminal-prompts:${createUuidV4()}`,
            agent,
            sessionId: provider.id,
            limit: 200,
            transcriptPath: provider.transcriptPath
          },
          (frame) => {
            if (!disposed && transcriptIdentity === identity) {
              const prompts = terminalTranscriptPrompts(frame.messages)
              if (prompts.length > 0) {
                history.seedPrompts(prompts, frame.type === 'appended')
                scheduleRefresh()
              }
            }
          }
        )
      }
    }
    const gate = createTerminalPromptRefreshGate(
      refresh,
      (run) => scheduleAfterInputQuiet(run, REFRESH_SCHEDULE),
      activeRef.current
    )
    gateRef.current = gate
    const scheduleRefresh = gate.request
    acceptStatus(false)
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.agentStatusByPaneKey[paneKey] !== previous.agentStatusByPaneKey[paneKey]) {
        acceptStatus(true)
      }
    })
    const scroll = pane.terminal.onScroll(scheduleRefresh)
    const parsed = pane.terminal.onWriteParsed(scheduleRefresh)
    const buffer = pane.terminal.buffer.onBufferChange(scheduleRefresh)
    return () => {
      disposed = true
      gate.dispose()
      gateRef.current = null
      unsubscribe()
      unsubscribeTranscript?.()
      scroll.dispose()
      parsed.dispose()
      buffer.dispose()
      historyRef.current = null
    }
  }, [pane.terminal, pane.leafId, tabId])
  useEffect(() => {
    activeRef.current = active
    gateRef.current?.setActive(active)
  }, [active])
  const jump = (): void => {
    const line = historyRef.current?.currentLine(true)
    if (line !== null && line !== undefined) {
      pane.terminal.scrollToLine(line)
    }
  }
  return visible && context.known
    ? createPortal(<PromptStrip context={context} onJump={jump} />, pane.container)
    : null
}
