import type { TerminalModelPickerScreen } from './terminal-model-picker-screen'

export type Transaction = {
  id: string
  terminal: string
  ptyId: string
  token: symbol
  screen?: TerminalModelPickerScreen
  options: Map<string, number>
  expired: boolean
  pending: boolean
  timer: ReturnType<typeof setTimeout>
}
