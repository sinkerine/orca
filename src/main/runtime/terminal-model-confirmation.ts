import type { TerminalModelPickerScreen } from './terminal-model-picker-screen'

export function terminalModelConfirmation(lines: string[]): string {
  return lines.filter((line) => /Model changed to|Set model to|Model: /.test(line)).join('\n')
}

export function terminalModelSelectionConfirmed(
  lines: string[],
  live: TerminalModelPickerScreen,
  number: number,
  priorConfirmation: string
): boolean {
  const confirmed =
    live.provider === 'codex'
      ? lines.some((line) => /^\s*• Model changed to \S+ .+/.test(line))
      : live.provider === 'claude'
        ? lines.some((line) => /Set model to .+ for this session only/.test(line))
        : lines.some((line) => /^\s*Model: \S+/.test(line))
  const piModel =
    live.provider === 'pi'
      ? live.rows.find((row) => row.number === number)?.label.split(' [')[0]
      : undefined
  const piFooterConfirmed =
    piModel !== undefined &&
    lines.some(
      (line) =>
        /(?:^|\s)/.test(line.slice(0, line.indexOf(`${piModel} • `)).slice(-1)) &&
        line.includes(`${piModel} • `)
    )
  return piFooterConfirmed || (confirmed && terminalModelConfirmation(lines) !== priorConfirmation)
}
