import type { Terminal } from '@xterm/xterm'
import { showTerminalCopyFailure } from './terminal-copy-failure'

type TerminalSelectionCopyOptions = {
  terminal: Pick<Terminal, 'getSelection' | 'clearSelection'>
  writeClipboardText: (text: string) => Promise<void>
  clearSelectionOnSuccess?: boolean
}

export async function copyTerminalSelection({
  terminal,
  writeClipboardText,
  clearSelectionOnSuccess = false
}: TerminalSelectionCopyOptions): Promise<boolean> {
  const selection = terminal.getSelection()
  if (!selection) {
    return false
  }

  try {
    await writeClipboardText(selection)
  } catch (error) {
    showTerminalCopyFailure()
    throw error
  }
  // Keep failed-copy text selected for retry.
  if (clearSelectionOnSuccess) {
    terminal.clearSelection()
  }
  return true
}
