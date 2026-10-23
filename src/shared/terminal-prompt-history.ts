import type { IMarker, Terminal } from '@xterm/xterm'
import type { AgentStatusEntry } from './agent-status-types'
import { findTerminalPromptRow } from './terminal-prompt-position'

type PromptStatus = Pick<
  AgentStatusEntry,
  'prompt' | 'promptInteractionKey' | 'turnStartedAt' | 'restoredUnconfirmed' | 'sessionBoundary'
>
type PromptAnchor = { text: string; key: string; marker: IMarker | undefined }
const MAX_PROMPTS = 200

/** Presentation history belongs to this terminal buffer, never to the execution host's status. */
export class TerminalPromptHistory {
  private anchors: PromptAnchor[] = []

  constructor(private terminal: Pick<Terminal, 'buffer' | 'registerMarker'>) {}

  acceptStatus(status: PromptStatus | undefined, live = true): void {
    // Feed loss is not a session boundary, especially over SSH.
    if (!status) {
      return
    }
    if (status.sessionBoundary) {
      this.dispose()
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
    this.anchors.push({ text: status.prompt, key, marker })
    while (this.anchors.length > MAX_PROMPTS) {
      this.anchors.shift()?.marker?.dispose()
    }
  }

  private selected(): PromptAnchor | undefined {
    this.prune()
    const buffer = this.terminal.buffer.active
    if (buffer.type === 'alternate' || buffer.viewportY >= buffer.baseY) {
      return this.anchors.at(-1)
    }
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      const anchor = this.anchors[i]
      if (anchor.marker && anchor.marker.line <= buffer.viewportY) {
        return anchor
      }
    }
    return undefined
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
