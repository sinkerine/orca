import type { IBuffer } from '@xterm/xterm'

const SEARCH_RADIUS = 200
const MAX_SEARCH_CHARACTERS = 64_000
const MAX_PROMPT_CHARACTERS = 8_000

/** Match complete prompt text, retaining physical row positions through wrapping. */
export function findTerminalPromptRow(
  buffer: IBuffer,
  prompt: string,
  near: number,
  after = -1,
  before = buffer.length
): number | null {
  const needle = prompt.replace(/\s+/g, ' ').trim()
  if (!needle || needle.length > MAX_PROMPT_CHARACTERS) {
    return null
  }
  const first = Math.max(0, after + 1, near - SEARCH_RADIUS)
  const last = Math.min(buffer.length - 1, before - 1, near + SEARCH_RADIUS)
  let text = ''
  const rows: number[] = []
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row)
    if (!line) {
      continue
    }
    if (row > first && !line.isWrapped && !text.endsWith(' ')) {
      text += ' '
      rows.push(row)
    }
    // Spaces at a soft-wrap boundary belong to the prompt; hard-line padding does not.
    const content = line.translateToString(!buffer.getLine(row + 1)?.isWrapped)
    for (const character of content) {
      const normalized = /\s/.test(character) ? ' ' : character
      if (normalized === ' ' && text.endsWith(' ')) {
        continue
      }
      text += normalized
      // String search offsets use UTF-16 code units, including surrogate pairs.
      for (let unit = 0; unit < normalized.length; unit++) {
        rows.push(row)
      }
    }
    if (text.length > MAX_SEARCH_CHARACTERS) {
      return null
    }
  }
  const index = text.indexOf(needle)
  if (index === -1 || text.includes(needle, index + 1)) {
    return null
  }
  // A partial word in an answer is not evidence of the submitted prompt.
  if (
    (index > 0 && /[\p{L}\p{N}_]/u.test(text[index - 1])) ||
    /[\p{L}\p{N}_]/u.test(text[index + needle.length] ?? '')
  ) {
    return null
  }
  return rows[index] ?? null
}
