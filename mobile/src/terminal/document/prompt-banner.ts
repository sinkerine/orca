import type { Terminal } from '@xterm/xterm'
import {
  terminalPromptHistory,
  type TerminalPromptHistory,
  type TerminalPromptStatus
} from '../../../../src/shared/terminal-prompt-history'
import {
  createTerminalPromptRefreshGate,
  type TerminalPromptRefreshGate,
  type TerminalPromptRefreshScheduler
} from '../../../../src/shared/terminal-prompt-refresh-gate'
import type { TerminalDocumentScope } from './document-scope'
import { notify } from './host-notify'

/** What xterm offers beyond the document's narrowed shape: markers and buffer-switch events. */
type PromptTerminal = Pick<
  Terminal,
  'buffer' | 'registerMarker' | 'onScroll' | 'onWriteParsed' | 'scrollToLine'
>

type PromptSeed = { id: string; text: string }

type PromptContext = { text: string; known: boolean; jumpable: boolean }

/** `prompt-banner`: the banner's inputs and the history of the terminal it is attached to. */
export type TerminalPromptBannerState = {
  status: TerminalPromptStatus | null
  seeds: PromptSeed[]
  history: TerminalPromptHistory | null
  terminal: PromptTerminal | null
  listeners: { dispose: () => void }[]
  gate: TerminalPromptRefreshGate
  published: PromptContext
}

// An engine double without markers simply has no banner.
function isPromptTerminal(term: object): term is PromptTerminal {
  return (
    'registerMarker' in term &&
    typeof term.registerMarker === 'function' &&
    'onScroll' in term &&
    typeof term.onScroll === 'function' &&
    'onWriteParsed' in term &&
    typeof term.onWriteParsed === 'function' &&
    'buffer' in term &&
    typeof term.buffer === 'object' &&
    term.buffer !== null &&
    'onBufferChange' in term.buffer &&
    typeof term.buffer.onBufferChange === 'function'
  )
}

// Chrome 74 has requestIdleCallback; the timer covers a host page without it.
const scheduleIdleRefresh: TerminalPromptRefreshScheduler = (run) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 250 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 50)
  return () => clearTimeout(id)
}

function bannerState(scope: TerminalDocumentScope): TerminalPromptBannerState {
  if (!scope.promptBanner) {
    scope.promptBanner = {
      status: null,
      seeds: [],
      history: null,
      terminal: null,
      listeners: [],
      gate: createTerminalPromptRefreshGate(() => publishPromptContext(scope), scheduleIdleRefresh),
      published: { text: '', known: false, jumpable: false }
    }
  }
  return scope.promptBanner
}

function publishPromptContext(scope: TerminalDocumentScope) {
  const state = bannerState(scope)
  const history = state.history
  history?.refreshPositions()
  const next = {
    text: history?.current() ?? '',
    known: history?.hasPrompts() ?? false,
    jumpable: history?.canAttemptJump() ?? false
  }
  const last = state.published
  if (next.text === last.text && next.known === last.known && next.jumpable === last.jumpable) {
    return
  }
  state.published = next
  notify(scope, { type: 'prompt-context', ...next })
}

function detachListeners(state: TerminalPromptBannerState) {
  for (const listener of state.listeners) {
    try {
      listener.dispose()
    } catch {}
  }
  state.listeners = []
}

/** `terminal-init` calls this for every terminal it opens, including a surface swap's replacement. */
export function attachPromptBanner(scope: TerminalDocumentScope, term: object) {
  const state = bannerState(scope)
  detachListeners(state)
  if (!isPromptTerminal(term)) {
    state.history = null
    state.terminal = null
    return
  }
  const history = terminalPromptHistory(term)
  history.acceptStatus(state.status ?? undefined, false)
  history.seedPrompts(state.seeds)
  state.history = history
  state.terminal = term
  const request = state.gate.request
  state.listeners = [
    term.onScroll(request),
    term.onWriteParsed(request),
    term.buffer.onBufferChange(request)
  ]
  request()
}

function readStatus(value: unknown): TerminalPromptStatus | null {
  if (!value || typeof value !== 'object' || !('prompt' in value)) {
    return null
  }
  const prompt = value.prompt
  if (typeof prompt !== 'string') {
    return null
  }
  const field = (name: string): unknown => (name in value ? Reflect.get(value, name) : undefined)
  const interactionKey = field('promptInteractionKey')
  const turnStartedAt = field('turnStartedAt')
  return {
    prompt,
    promptInteractionKey: typeof interactionKey === 'string' ? interactionKey : undefined,
    turnStartedAt: typeof turnStartedAt === 'number' ? turnStartedAt : undefined,
    restoredUnconfirmed: field('restoredUnconfirmed') === true ? true : undefined,
    sessionBoundary: field('sessionBoundary') === true ? true : undefined
  }
}

function readSeeds(value: unknown): PromptSeed[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((seed: unknown) =>
    seed &&
    typeof seed === 'object' &&
    'id' in seed &&
    typeof seed.id === 'string' &&
    'text' in seed &&
    typeof seed.text === 'string'
      ? [{ id: seed.id, text: seed.text }]
      : []
  )
}

export function setPromptStatus(scope: TerminalDocumentScope, value: unknown) {
  const state = bannerState(scope)
  state.status = readStatus(value)
  state.history?.acceptStatus(state.status ?? undefined)
  state.gate.request()
}

export function seedPrompts(scope: TerminalDocumentScope, value: unknown, appended: boolean) {
  const state = bannerState(scope)
  const seeds = readSeeds(value)
  if (seeds.length === 0) {
    return
  }
  // Kept so a replacement terminal is seeded the same way; the history dedupes by id.
  const known = new Set(state.seeds.map((seed) => seed.id))
  const fresh = seeds.filter((seed) => !known.has(seed.id))
  state.seeds = (appended ? [...state.seeds, ...fresh] : [...fresh, ...state.seeds]).slice(-200)
  state.history?.seedPrompts(seeds, appended)
  state.gate.request()
}

export function setPromptActive(scope: TerminalDocumentScope, active: boolean) {
  bannerState(scope).gate.setActive(active)
}

export function jumpToPrompt(scope: TerminalDocumentScope) {
  const state = bannerState(scope)
  const line = state.history?.currentLine(true)
  if (state.terminal && line !== null && line !== undefined) {
    state.terminal.scrollToLine(line)
    publishPromptContext(scope)
  }
}

export function stopPromptBanner(scope: TerminalDocumentScope) {
  const state = scope.promptBanner
  if (!state) {
    return
  }
  detachListeners(state)
  state.gate.dispose()
  state.history = null
  state.terminal = null
  scope.promptBanner = null
}
