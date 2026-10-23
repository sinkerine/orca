import { z } from 'zod'
import { defineRpcOperation } from '../transport/rpc-operation'

const choice = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional()
})
const result = z.object({
  terminal: z.string(),
  phase: z.enum(['model', 'effort', 'applied', 'cancelled', 'unavailable', 'uncertain']),
  transactionId: z.string().optional(),
  message: z.string().optional(),
  descriptor: z
    .object({
      id: z.string(),
      label: z.string(),
      kind: z.object({ type: z.literal('select'), choices: z.array(choice) })
    })
    .optional()
})

export type MobileTerminalModelResult = z.infer<typeof result>

export const terminalModelControl = defineRpcOperation({
  name: 'terminal.model-control',
  method: 'terminal.modelControl',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: (raw: unknown) => ({
    compatible: true as const,
    variant: 'model-control' as const,
    value: result.parse(raw),
    salvage: { droppedPaths: [], droppedCount: 0 }
  })
})
