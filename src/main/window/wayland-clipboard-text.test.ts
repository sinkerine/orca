import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))
vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('../linux-wayland-session', () => ({ isLinuxWaylandSession: () => true }))
vi.mock('electron', () => ({ clipboard: { writeText: vi.fn(), readText: vi.fn() } }))

import { clipboard } from 'electron'
import { writeClipboardTextAndVerify } from './clipboard-text-write-verify'

const success = { code: 0, timedOut: false, stdout: '', stderr: '', signal: null }

describe('Wayland terminal clipboard writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runProcessMock.mockResolvedValue(success)
  })

  it('publishes to the local compositor rather than verifying Electron cached text', async () => {
    const text = 'remote α\nsecond line 雪'
    await writeClipboardTextAndVerify(text)
    expect(runProcessMock).toHaveBeenCalledWith({
      program: 'wl-copy',
      args: ['--type', 'text/plain;charset=utf-8'],
      input: text,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeoutMs: 5_000,
      maxOutputBytes: 1024
    })
    expect(clipboard.writeText).toHaveBeenCalledWith(text)
    expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('propagates a missing local helper error unchanged', async () => {
    const error = Object.assign(new Error('spawn wl-copy ENOENT'), { code: 'ENOENT' })
    runProcessMock.mockRejectedValue(error)
    await expect(writeClipboardTextAndVerify('text')).rejects.toBe(error)
  })

  it.each([
    { code: 1, timedOut: false },
    { code: null, timedOut: true }
  ])('rejects failed helper results: %j', async (result) => {
    runProcessMock.mockResolvedValue({ ...success, ...result })
    await expect(writeClipboardTextAndVerify('text')).rejects.toThrow('local Wayland clipboard')
  })
})
