import { defineMethod } from '../../core'
import { TerminalModelControl } from '../../../../../shared/rpc-contract/terminal-unary-params'
import { controlTerminalModel } from '../../../terminal-model-control'
import { assertSenderOwnsTerminal } from './terminal-window-ownership'

export const TERMINAL_MODEL_CONTROL_METHODS = [
  defineMethod({
    name: 'terminal.modelControl',
    permission: 'workspace',
    params: TerminalModelControl,
    handler: async (params, { runtime, senderWindowId }) => {
      assertSenderOwnsTerminal(runtime, params.terminal, senderWindowId)
      return controlTerminalModel(runtime, params)
    }
  })
]
