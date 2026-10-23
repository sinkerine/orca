import { randomUUID } from 'node:crypto'
import type { TerminalModelControlResult } from '../../shared/terminal-model-control'
import type { TerminalModelPickerScreen } from './terminal-model-picker-screen'

export function describeTerminalModelPicker(
  tx: {
    terminal: string
    id: string
    screen?: TerminalModelPickerScreen
    options: Map<string, number>
  },
  screen: TerminalModelPickerScreen
): TerminalModelControlResult {
  tx.screen = screen
  tx.options.clear()
  const choices = screen.rows
    .filter((row) => row.label !== 'More reasoning…')
    .map((row) => {
      const value = randomUUID()
      tx.options.set(value, row.number)
      return {
        value,
        label: row.label,
        ...(row.description ? { description: row.description } : {})
      }
    })
  return {
    terminal: tx.terminal,
    transactionId: tx.id,
    phase: screen.phase,
    descriptor: {
      id: screen.phase,
      label: screen.heading,
      category: screen.phase === 'model' ? 'model' : 'thought_level',
      kind: { type: 'select', choices },
      valueSource: 'unknown',
      transport: 'catalog',
      settable: true
    }
  }
}
