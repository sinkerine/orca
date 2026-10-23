import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { runRpcOperation } from '../transport/rpc-operation'
import {
  terminalModelControl,
  type MobileTerminalModelResult
} from './terminal-model-control-operation'

export function useTerminalModelPicker(client: RpcClient | null, terminal: string | null) {
  const [result, setResult] = useState<MobileTerminalModelResult | null>(null)
  const [pending, setPending] = useState(false)
  const active = useRef({ client, terminal, generation: 0 })
  const transaction = useRef<string | undefined>(undefined)
  const inFlight = useRef(false)

  useEffect(() => {
    active.current = { client, terminal, generation: active.current.generation + 1 }
    transaction.current = undefined
    inFlight.current = false
    setResult(null)
    setPending(false)
    return () => {
      active.current = { ...active.current, generation: active.current.generation + 1 }
      const id = transaction.current
      if (client && terminal && id) {
        void runRpcOperation(
          client,
          terminalModelControl,
          {
            terminal,
            action: 'cancel',
            transactionId: id
          },
          { timeoutMs: 15_000, budgetSpansConnect: true }
        ).catch(() => undefined)
      }
    }
  }, [client, terminal])

  const perform = useCallback(
    async (action: 'open' | 'select' | 'cancel' | 'release', optionId?: string) => {
      if (!client || !terminal || inFlight.current) {
        return
      }
      const origin = active.current
      const id = transaction.current
      inFlight.current = true
      setPending(true)
      try {
        const next = await runRpcOperation(
          client,
          terminalModelControl,
          {
            terminal,
            action,
            ...(id ? { transactionId: id } : {}),
            ...(optionId ? { optionId } : {})
          },
          { timeoutMs: 15_000, budgetSpansConnect: true }
        )
        if (active.current !== origin || active.current.generation !== origin.generation) {
          if (next.transactionId) {
            void runRpcOperation(
              client,
              terminalModelControl,
              {
                terminal,
                action: 'cancel',
                transactionId: next.transactionId
              },
              { timeoutMs: 15_000, budgetSpansConnect: true }
            ).catch(() => undefined)
          }
          return
        }
        transaction.current =
          next.phase === 'applied' || next.phase === 'cancelled' ? undefined : next.transactionId
        setResult(
          next.phase === 'applied' ||
            next.phase === 'cancelled' ||
            (action === 'cancel' && next.phase === 'unavailable' && !next.transactionId)
            ? null
            : next
        )
      } catch {
        if (active.current === origin) {
          setResult({
            terminal,
            phase: 'uncertain',
            ...(id ? { transactionId: id } : {}),
            message: 'Could not confirm model selection. Check the terminal before trying again.'
          })
        }
      } finally {
        if (active.current === origin) {
          inFlight.current = false
          setPending(false)
        }
      }
    },
    [client, terminal]
  )

  return {
    result,
    pending,
    visible: pending || result !== null,
    open: () => void perform('open'),
    select: (value: string) => void perform('select', value),
    close: () => {
      if (inFlight.current) {
        return
      }
      if (transaction.current) {
        void perform('cancel')
      } else {
        setResult(null)
      }
    },
    release: () => void perform(transaction.current ? 'release' : 'open')
  }
}
