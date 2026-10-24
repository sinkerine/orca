import type { IMarker, Terminal } from '@xterm/xterm'
import type { AgentStatusEntry } from './agent-status-types'
import { findTerminalPromptRow, terminalPromptWindow } from './terminal-prompt-position'

type PromptStatus = Pick<
  AgentStatusEntry,
  'prompt' | 'promptInteractionKey' | 'turnStartedAt' | 'restoredUnconfirmed' | 'sessionBoundary'
>
type PromptAnchor = { text: string; key: string; marker: IMarker | undefined; positioned: boolean }
const histories = new WeakMap<object, TerminalPromptHistory>()
const MAX_PROMPTS = 200

export function terminalPromptHistory(
  terminal: Pick<Terminal, 'buffer' | 'registerMarker'>
): TerminalPromptHistory {
  const retained = histories.get(terminal)
  if (retained) {
    return retained
  }
  const history = new TerminalPromptHistory(terminal)
  histories.set(terminal, history)
  return history
}

/** Presentation history belongs to this terminal buffer, never to the execution host's status. */
export class TerminalPromptHistory {
  private anchors: PromptAnchor[] = []
  private scanKey = ''

  constructor(private terminal: Pick<Terminal, 'buffer' | 'registerMarker'>) {}

  acceptStatus(status: PromptStatus | undefined, live = true): void {
    // Feed loss is not a session boundary, especially over SSH.
    if (!status) {
      return
    }
    // Ending the agent leaves its terminal transcript readable.
    if (status.sessionBoundary) {
      return
    }
    if (!status.prompt.trim()) {
      return
    }
    const key = JSON.stringify([
      status.promptInteractionKey ?? status.turnStartedAt ?? null,
      status.prompt
    ])
    if (this.anchors.at(-1)?.key === key) {
      return
    }
    this.prune()
    const buffer = this.terminal.buffer.active
    const cursor = buffer.baseY + buffer.cursorY
    const previousLine = this.anchors.at(-1)?.marker?.line ?? -1
    const matched =
      buffer.type === 'normal'
        ? findTerminalPromptRow(buffer, status.prompt, cursor, previousLine)
        : null
    const marker =
      buffer.type === 'normal' && (matched !== null || (live && !status.restoredUnconfirmed))
        ? this.terminal.registerMarker((matched ?? cursor) - cursor)
        : undefined
    this.anchors.push({ text: status.prompt, key, marker, positioned: matched !== null })
    while (this.anchors.length > MAX_PROMPTS) {
      this.anchors.shift()?.marker?.dispose()
    }
  }

  seedPrompts(prompts: readonly { id: string; text: string }[]): void {
    const existing = new Set(this.anchors.map((anchor) => anchor.key))
    const latestText = this.anchors.at(-1)?.text
    const restored = prompts
      .filter(
        (prompt, index) =>
          prompt.text.trim() &&
          !existing.has(`transcript:${prompt.id}`) &&
          !(index === prompts.length - 1 && prompt.text === latestText)
      )
      .slice(-MAX_PROMPTS)
      .map((prompt) => ({
        text: prompt.text,
        key: `transcript:${prompt.id}`,
        marker: undefined,
        positioned: false
      }))
    const combined = [...restored, ...this.anchors]
    for (const anchor of combined.slice(0, Math.max(0, combined.length - MAX_PROMPTS))) {
      anchor.marker?.dispose()
    }
    this.anchors = combined.slice(-MAX_PROMPTS)
    this.scanKey = ''
  }

  /** Replay and delayed output can place a prompt after its status was accepted. */
  refreshPositions(): void {
    this.prune()
    const buffer = this.terminal.buffer.active
    if (buffer.type !== 'normal') {
      return
    }
    const key = `${buffer.viewportY}:${buffer.baseY}:${buffer.cursorY}:${this.anchors.length}`
    if (key === this.scanKey) {
      return
    }
    this.scanKey = key
    const find = terminalPromptWindow(buffer, buffer.viewportY)
    for (const anchor of this.anchors) {
      if (!anchor.positioned) {
        const row = find(anchor.text)
        const shortSeed = anchor.key.startsWith('transcript:') && anchor.text.trim().length < 12
        const rowText =
          row === null ? '' : (buffer.getLine(row)?.translateToString(true).trimStart() ?? '')
        if (row !== null && (!shortSeed || /^(?:>|❯|›|you\s*[:>])/i.test(rowText))) {
          const marker = this.terminal.registerMarker(row - (buffer.baseY + buffer.cursorY))
          if (marker) {
            anchor.marker?.dispose()
            anchor.marker = marker
            anchor.positioned = true
          }
        }
      }
    }
  }

  private selected(): PromptAnchor | undefined {
    this.prune()
    const buffer = this.terminal.buffer.active
    if (buffer.type === 'alternate' || buffer.viewportY >= buffer.baseY) {
      return this.anchors.at(-1)
    }
    let selected: PromptAnchor | undefined
    for (const anchor of this.anchors) {
      if (
        anchor.marker &&
        anchor.marker.line <= buffer.viewportY &&
        (!selected?.marker || anchor.marker.line >= selected.marker.line)
      ) {
        selected = anchor
      }
    }
    return selected
  }

  current(): string | null {
    return this.selected()?.text ?? null
  }

  currentLine(refine = false): number | null {
    if (this.terminal.buffer.active.type !== 'normal') {
      return null
    }
    const anchor = this.selected()
    if (!anchor) {
      return null
    }
    if (!refine) {
      return anchor.marker?.line ?? null
    }
    const buffer = this.terminal.buffer.active
    const index = this.anchors.indexOf(anchor)
    const previousLine = this.anchors[index - 1]?.marker?.line ?? -1
    const nextLine = this.anchors[index + 1]?.marker?.line ?? buffer.length
    const matched = findTerminalPromptRow(
      buffer,
      anchor.text,
      anchor.marker?.line ?? buffer.baseY + buffer.cursorY,
      previousLine,
      nextLine
    )
    if (matched !== null && matched !== anchor.marker?.line) {
      const refined = this.terminal.registerMarker(matched - (buffer.baseY + buffer.cursorY))
      if (refined) {
        anchor.marker?.dispose()
        anchor.marker = refined
        anchor.positioned = true
      }
    }
    return anchor.marker?.line ?? null
  }

  canAttemptJump(): boolean {
    return this.terminal.buffer.active.type === 'normal' && this.selected() !== undefined
  }

  hasPrompts(): boolean {
    return this.anchors.length > 0
  }

  private prune(): void {
    // Trimming loses the position, not the current turn's prompt text.
    for (const anchor of this.anchors) {
      if (anchor.marker?.isDisposed) {
        anchor.marker = undefined
        anchor.positioned = false
        this.scanKey = ''
      }
    }
  }

  dispose(): void {
    for (const anchor of this.anchors) {
      anchor.marker?.dispose()
    }
    this.anchors = []
  }
}
