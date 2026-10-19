import { clipboard } from 'electron'
import { usesWaylandClipboard, writeWaylandClipboardText } from './wayland-clipboard-text'

export const CLIPBOARD_WRITE_VERIFICATION_FAILED_ERROR = 'Clipboard write verification failed'

// Electron can silently leave the Windows clipboard unchanged under contention.
export function writeClipboardTextAndVerify(text: string): void | Promise<void> {
  clipboard.writeText(text)
  if (usesWaylandClipboard()) {
    return writeWaylandClipboardText(text)
  }
  verifyClipboardText(text)
}

function verifyClipboardText(text: string): void {
  // Strict identity: multi-line TUI content must round-trip byte-for-byte.
  if (clipboard.readText() !== text) {
    throw new Error(CLIPBOARD_WRITE_VERIFICATION_FAILED_ERROR)
  }
}
