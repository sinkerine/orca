import { randomUUID } from 'node:crypto'
import { describeTerminalModelPicker } from './terminal-model-descriptor'
import {
  terminalModelConfirmation,
  terminalModelSelectionConfirmed
} from './terminal-model-confirmation'
import { restoreProjectedComposerDraft } from './orca-runtime-terminal-projection'
import type { OrcaRuntimeService } from './orca-runtime'
import type {
  TerminalModelControlRequest,
  TerminalModelControlResult
} from '../../shared/terminal-model-control'
import { isCodexComposerReadyScreen } from './agent-state-rules/codex-screen-predicates'
import {
  reserveTerminalModelInput,
  releaseTerminalModelInput,
  withTerminalModelInput
} from './terminal-model-input-lease'
import {
  readTerminalModelPickerScreen,
  terminalModelPickerSignature,
  terminalModelComposerProvider,
  type TerminalModelPickerScreen
} from './terminal-model-picker-screen'

import type { Transaction } from './terminal-model-transaction'
export type TerminalModelRuntime = Pick<
  OrcaRuntimeService,
  'resolveLiveLeafForHandle' | 'readTerminal' | 'getTerminalAgentStatus' | 'sendTerminal'
>
const transactions = new WeakMap<TerminalModelRuntime, Map<string, Transaction>>()
const LEASE_MS = 120_000

export async function controlTerminalModel(
  runtime: TerminalModelRuntime,
  request: TerminalModelControlRequest
): Promise<TerminalModelControlResult> {
  let active = transactions.get(runtime)
  if (!active) {
    active = new Map()
    transactions.set(runtime, active)
  }
  const result = (
    phase: TerminalModelControlResult['phase'],
    message?: string
  ): TerminalModelControlResult => ({
    terminal: request.terminal,
    phase,
    ...(message ? { message } : {})
  })
  let transaction = active.get(request.terminal)
  if (request.action === 'open') {
    if (transaction) {
      return {
        ...result(
          'uncertain',
          'A model picker is already open. Cancel it or return control to the terminal.'
        ),
        transactionId: transaction.id
      }
    }
    const ptyId = runtime.resolveLiveLeafForHandle(request.terminal)?.ptyId
    if (!ptyId) {
      return result('unavailable', 'The terminal is no longer writable.')
    }
    const token = reserveTerminalModelInput(ptyId)
    transaction = {
      id: randomUUID(),
      terminal: request.terminal,
      ptyId,
      token,
      options: new Map(),
      pending: false,
      expired: false,
      timer: setTimeout(() => {
        const expiring = active.get(request.terminal)
        if (!expiring || expiring.token !== token) {
          return
        }
        expiring.expired = true
        // Pending operations observe expiry before every write and release in finally.
        if (!expiring.pending) {
          releaseTerminalModelInput(ptyId, token)
          active.delete(request.terminal)
        }
      }, LEASE_MS)
    }
    transaction.timer.unref()
    active.set(request.terminal, transaction)
  } else if (!transaction || transaction.id !== request.transactionId) {
    return result('unavailable', 'The model picker has expired. Open it again.')
  }
  if (!transaction) {
    return result('unavailable')
  }
  const tx = transaction
  if (tx.pending) {
    return { ...result('unavailable', 'A model selection is still pending.'), transactionId: tx.id }
  }
  const finish = (): void => {
    clearTimeout(tx.timer)
    releaseTerminalModelInput(tx.ptyId, tx.token)
    if (active.get(tx.terminal) === tx) {
      active.delete(tx.terminal)
    }
  }
  if (request.action === 'release') {
    finish()
    return result(
      'cancelled',
      'Terminal input released. The agent screen may still need attention.'
    )
  }
  const assertBinding = (): void => {
    if (tx.expired || active.get(tx.terminal) !== tx) {
      throw new Error('The model picker expired. Release it and open it again.')
    }
    if (runtime.resolveLiveLeafForHandle(tx.terminal)?.ptyId !== tx.ptyId) {
      throw new Error('terminal_handle_stale')
    }
  }
  const read = async (): Promise<string[]> => {
    assertBinding()
    const screen = await runtime.readTerminal(tx.terminal, { screen: true })
    assertBinding()
    if (screen.source !== 'screen' || screen.status !== 'running') {
      throw new Error('Live terminal screen unavailable.')
    }
    return restoreProjectedComposerDraft(screen.tail, screen.draft).map((line) => line.trimEnd())
  }
  let effectPossible = request.action !== 'open'
  const operationDeadline = Date.now() + 10_000
  const send = async (text: string): Promise<void> => {
    if (Date.now() > operationDeadline) {
      throw new Error('Model selection timed out. Cancel or release the picker.')
    }
    assertBinding()
    const status = await runtime.getTerminalAgentStatus(tx.terminal)
    assertBinding()
    if (!status.isRunningAgent || status.status !== 'idle') {
      throw new Error('Agent is busy or blocked.')
    }
    effectPossible = true
    const sent = await withTerminalModelInput(tx.token, () =>
      runtime.sendTerminal(
        tx.terminal,
        { text },
        {
          inputKind: 'driving',
          requireWriteSettlement: true,
          beforeWrite: assertBinding
        }
      )
    )
    if (!sent.accepted || sent.writeSettlement?.outcome !== 'accepted') {
      throw new Error('Terminal input delivery could not be confirmed.')
    }
  }
  const waitFor = async <T>(predicate: (lines: string[]) => T | null): Promise<T> => {
    const deadline = Math.min(operationDeadline, Date.now() + 2500)
    while (Date.now() < deadline) {
      const value = predicate(await read())
      if (value !== null) {
        return value
      }
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    throw new Error('The agent did not show the expected model screen.')
  }
  const describe = (screen: TerminalModelPickerScreen): TerminalModelControlResult =>
    describeTerminalModelPicker(tx, screen)
  tx.pending = true
  try {
    if (request.action === 'open') {
      const lines = await read()
      const provider = terminalModelComposerProvider(lines)
      if (
        !provider ||
        (provider === 'codex' && !isCodexComposerReadyScreen(lines.join('\n').toLowerCase()))
      ) {
        finish()
        return result(
          'unavailable',
          'Model selection requires an idle supported terminal with an empty composer.'
        )
      }
      await send('/model')
      await waitFor((lines) =>
        lines.some((line) =>
          (provider === 'pi' ? /^\s*(?:> )?\/model\s*$/ : /^\s*[›❯]\s+\/model\s*$/).test(line)
        )
          ? true
          : null
      )
      await send('\r')
      return describe(
        await waitFor((lines) => {
          const picker = readTerminalModelPickerScreen(lines)
          return picker?.provider === provider ? picker : null
        })
      )
    }
    const live = readTerminalModelPickerScreen(await read())
    if (
      !tx.screen ||
      !live ||
      terminalModelPickerSignature(live) !== terminalModelPickerSignature(tx.screen)
    ) {
      throw new Error('The model picker changed. Cancel and refresh it.')
    }
    if (request.action === 'cancel') {
      await send('\x1b')
      const after = await waitFor((lines) => {
        if (terminalModelComposerProvider(lines) === live.provider) {
          return { composer: true }
        }
        const next = readTerminalModelPickerScreen(lines)
        return next && terminalModelPickerSignature(next) !== terminalModelPickerSignature(live)
          ? { composer: false }
          : null
      })
      if (!after.composer) {
        await send('\x1b')
      }
      await waitFor((lines) =>
        terminalModelComposerProvider(lines) === live.provider ? true : null
      )
      finish()
      return result('cancelled')
    }
    const number = request.optionId ? tx.options.get(request.optionId) : undefined
    if (!number) {
      throw new Error('The selected option is stale.')
    }
    let current = live
    for (let moves = 0; current.selected !== number && moves < 30; moves++) {
      const previous = current.selected
      const direction = number < previous ? -1 : 1
      await send(direction < 0 ? '\x1b[A' : '\x1b[B')
      current = await waitFor((lines) => {
        const next = readTerminalModelPickerScreen(lines)
        if (!next || terminalModelPickerSignature(next) !== terminalModelPickerSignature(live)) {
          return null
        }
        return next.selected === previous + direction ? next : null
      })
    }
    if (current.selected !== number) {
      throw new Error('Could not select the exact model option.')
    }
    // Re-read immediately before the committing key; row labels are never converted to model IDs.
    const beforeCommit = readTerminalModelPickerScreen(await read())
    if (
      !beforeCommit ||
      beforeCommit.selected !== number ||
      terminalModelPickerSignature(beforeCommit) !== terminalModelPickerSignature(live)
    ) {
      throw new Error('The model picker changed before selection.')
    }
    const priorConfirmation = terminalModelConfirmation(await read())
    await send(
      live.provider === 'claude' || (live.provider === 'codex' && live.phase === 'effort')
        ? 's'
        : '\r'
    )
    if (live.provider === 'codex' && live.phase === 'model') {
      const effort = await waitFor((lines) => {
        const next = readTerminalModelPickerScreen(lines)
        return next?.phase === 'effort' ? next : null
      })
      return describe(effort)
    }
    await waitFor((lines) => {
      if (terminalModelComposerProvider(lines) !== live.provider) {
        return null
      }
      return terminalModelSelectionConfirmed(lines, live, number, priorConfirmation) ? true : null
    })
    finish()
    return result('applied')
  } catch (error) {
    if (!effectPossible) {
      finish()
      return result(
        'unavailable',
        error instanceof Error ? error.message : 'Model selection is unavailable.'
      )
    }
    return {
      ...result(
        'uncertain',
        error instanceof Error ? error.message : 'Model selection could not be confirmed.'
      ),
      transactionId: tx.id
    }
  } finally {
    tx.pending = false
    if (tx.expired) {
      finish()
    }
  }
}
