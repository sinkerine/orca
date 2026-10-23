import type { SessionOptionDescriptor } from './native-chat-session-options'

export const TERMINAL_MODEL_CONTROL_CAPABILITY = 'terminal.model-control.v1' as const

export type TerminalModelControlRequest = {
  terminal: string
  action: 'open' | 'select' | 'cancel' | 'release'
  transactionId?: string
  optionId?: string
}

/** IDs belong to one live picker transaction; clients must never construct model commands. */
export type TerminalModelControlResult = {
  terminal: string
  phase: 'model' | 'effort' | 'applied' | 'cancelled' | 'unavailable' | 'uncertain'
  transactionId?: string
  descriptor?: SessionOptionDescriptor
  message?: string
}
