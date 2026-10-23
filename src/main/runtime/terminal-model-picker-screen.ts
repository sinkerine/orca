export type TerminalModelPickerScreen = {
  provider: 'codex' | 'claude' | 'pi'
  phase: 'model' | 'effort'
  heading: string
  rows: { number: number; label: string; description?: string }[]
  selected: number
}

/** Matches Codex 0.161's captured picker; unknown layouts are never writable. */
export function readTerminalModelPickerScreen(lines: string[]): TerminalModelPickerScreen | null {
  const other = readClaudePicker(lines) ?? readPiPicker(lines)
  if (other) {
    return other
  }
  const headingIndex = lines.findIndex((line) =>
    /^\s*(?:Select Model and Effort|Select Reasoning Level for .+)\s*$/.test(line)
  )
  if (headingIndex === -1) {
    return null
  }
  const heading = lines[headingIndex]!.trim()
  const body = lines.slice(headingIndex + 1)
  if (!body.some((line) => /enter (?:select|default).*esc back/.test(line))) {
    return null
  }
  const rows: TerminalModelPickerScreen['rows'] = []
  let selected = 0
  for (const line of body) {
    const match = line.match(/^\s*(›)?\s*(\d+)\.\s+(.+?)\s*$/)
    if (!match) {
      continue
    }
    const number = Number(match[2])
    const [label, description] = match[3]!.split(/\s{2,}/)
    if (
      !label ||
      (label.includes('…') && label !== 'More reasoning…') ||
      rows.some((row) => row.number === number)
    ) {
      return null
    }
    rows.push({ number, label, ...(description ? { description } : {}) })
    if (match[1]) {
      if (selected) {
        return null
      }
      selected = number
    }
  }
  if (!selected || !rows.length || rows.length > 30) {
    return null
  }
  if (rows.some((row, index) => row.number !== index + 1)) {
    return null
  }
  return {
    provider: 'codex',
    phase: heading === 'Select Model and Effort' ? 'model' : 'effort',
    heading,
    rows,
    selected
  }
}

export function terminalModelPickerSignature(screen: TerminalModelPickerScreen): string {
  return JSON.stringify([screen.provider, screen.phase, screen.heading, screen.rows])
}

function readClaudePicker(lines: string[]): TerminalModelPickerScreen | null {
  const start = lines.findIndex((line) => line.trim() === 'Select model')
  if (
    start === -1 ||
    !lines.some(
      (line) => line.includes('s to use this session only') && line.includes('Esc to cancel')
    )
  ) {
    return null
  }
  const rows: TerminalModelPickerScreen['rows'] = []
  let selected = 0
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*([❯↓↑])?\s*(\d+)\.\s+(.+?)\s*$/)
    if (!match) {
      continue
    }
    const number = Number(match[2])
    const [label, description] = match[3]!.split(/\s{2,}/)
    if (!label || label.includes('…')) {
      return null
    }
    rows.push({
      number,
      label: label.replace(/\s*✔$/, ''),
      ...(description ? { description } : {})
    })
    if (match[1] === '❯') {
      selected = number
    }
  }
  if (!selected || rows.length < 2 || rows.some((row, index) => row.number !== index + 1)) {
    return null
  }
  return { provider: 'claude', phase: 'model', heading: 'Select model', rows, selected }
}

function readPiPicker(lines: string[]): TerminalModelPickerScreen | null {
  const start = lines.findIndex(
    (line) =>
      line.trim() === 'Only showing models from configured providers. Use /login to add providers.'
  )
  if (
    start === -1 ||
    lines[start + 1]?.trim() !== '>' ||
    !lines.some((line) => /^\s*Model Name: .+/.test(line))
  ) {
    return null
  }
  const rows: TerminalModelPickerScreen['rows'] = []
  let selected = 0
  for (const line of lines.slice(start + 2)) {
    if (/^\s*Model Name:/.test(line)) {
      break
    }
    const match = line.match(/^\s*(→)?\s*(\S[^\n]* \[[^\]]+\])(?: ✓)?\s*$/)
    if (!match || match[2]!.includes('…')) {
      return null
    }
    const number = rows.length + 1
    rows.push({ number, label: match[2]! })
    if (match[1]) {
      selected = number
    }
  }
  if (!selected || !rows.length) {
    return null
  }
  return { provider: 'pi', phase: 'model', heading: 'Select model', rows, selected }
}

export function terminalModelComposerProvider(
  lines: string[]
): TerminalModelPickerScreen['provider'] | null {
  if (lines.some((line) => /^\s*› Ask Codex to do anything\s*$/.test(line))) {
    return 'codex'
  }
  if (
    lines.some((line) => /^\s*❯(?:\s*|\s+Try ".+")$/.test(line)) &&
    lines.some((line) => line.includes('for agents') && line.includes('permissions'))
  ) {
    return 'claude'
  }
  // Pi's empty editor is bounded by consecutive horizontal borders, before the cwd/footer.
  if (
    lines.some((line) => /^\s*pi v\d/.test(line)) &&
    lines.some(
      (line, index) =>
        /^─{10,}$/.test(line.trim()) && /^─{10,}$/.test(lines[index + 1]?.trim() ?? '')
    ) &&
    lines.at(-1)?.includes(' • ')
  ) {
    return 'pi'
  }
  return null
}
