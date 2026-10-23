import { AsyncLocalStorage } from 'node:async_hooks'

const writerToken = new AsyncLocalStorage<symbol>()
const leases = new Map<string, symbol>()

export function reserveTerminalModelInput(ptyId: string): symbol {
  if (leases.has(ptyId)) {
    throw new Error('terminal_model_control_in_progress')
  }
  const token = Symbol(ptyId)
  leases.set(ptyId, token)
  return token
}

export function terminalModelInputAllowed(ptyId: string, token = writerToken.getStore()): boolean {
  return !leases.has(ptyId) || leases.get(ptyId) === token
}

export function releaseTerminalModelInput(ptyId: string, token: symbol): void {
  if (leases.get(ptyId) === token) {
    leases.delete(ptyId)
  }
}

export function withTerminalModelInput<T>(token: symbol, operation: () => T): T {
  return writerToken.run(token, operation)
}
