import { runProcess } from '@orca/process-host'
export { isLinuxWaylandSession as usesWaylandClipboard } from '../linux-wayland-session'

export async function writeWaylandClipboardText(text: string): Promise<void> {
  // Electron's cached read-back can succeed even when Wayland rejects its selection serial.
  const result = await runProcess({
    program: 'wl-copy',
    args: ['--type', 'text/plain;charset=utf-8'],
    input: text,
    // The clipboard owner forks and must not retain pipes that delay process completion.
    stdio: ['pipe', 'ignore', 'ignore'],
    timeoutMs: 5_000,
    maxOutputBytes: 1024
  })
  if (result.code !== 0 || result.timedOut) {
    throw new Error('Unable to write the local Wayland clipboard with wl-copy')
  }
}
