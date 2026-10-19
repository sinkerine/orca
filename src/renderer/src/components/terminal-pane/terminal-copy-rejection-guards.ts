import { copyTerminalSelection } from './terminal-selection-copy'

export async function runTerminalCopy(args: {
  selection: string
  writeClipboardText: (text: string) => Promise<void>
  focus: () => void
}): Promise<void> {
  try {
    await copyTerminalSelection({
      terminal: { getSelection: () => args.selection, clearSelection: () => {} },
      writeClipboardText: args.writeClipboardText
    })
  } finally {
    args.focus()
  }
}

export async function runTerminalIdentityCopy(args: {
  text: string
  writeClipboardText: (text: string) => Promise<void>
  onSuccess: () => void
  onError: () => void
  focus: () => void
}): Promise<void> {
  try {
    await args.writeClipboardText(args.text)
    args.onSuccess()
  } catch {
    args.onError()
  } finally {
    args.focus()
  }
}
