import { describe, expect, it } from 'vitest'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { resolveClaudeLiveSessionIdUnderProcess } from './claude-live-process-session'

const SESSION_A = '3a1f4703-dfba-408d-baef-e23a3ac1aec3'
const SESSION_B = '043782bc-787c-47b7-98d8-a9e90ea4e175'

function row(pid: number, ppid: number, pgid: number, tpgid: number): ProcessTableRow {
  return { pid, ppid, pgid, tpgid, stat: 'S', command: 'x' }
}

function resolve(
  rows: ProcessTableRow[],
  files: Record<number, unknown>,
  rootPid = 100
): Promise<string | null> {
  return resolveClaudeLiveSessionIdUnderProcess(rootPid, {
    readRows: async () => rows,
    readSessionFile: async (pid) => {
      if (!(pid in files)) {
        throw new Error('ENOENT')
      }
      return JSON.stringify(files[pid])
    }
  })
}

describe('resolveClaudeLiveSessionIdUnderProcess', () => {
  it('reads the session of the Claude process in the terminal foreground', async () => {
    const rows = [row(100, 1, 100, 200), row(200, 100, 200, 200)]

    await expect(
      resolve(rows, { 200: { pid: 200, sessionId: SESSION_A, kind: 'interactive' } })
    ).resolves.toBe(SESSION_A)
  })

  it('finds Claude behind a wrapper and prefers the foreground group', async () => {
    const rows = [
      row(100, 1, 100, 300),
      row(250, 100, 250, 300),
      row(300, 100, 300, 300),
      row(301, 300, 300, 300)
    ]

    await expect(
      resolve(rows, {
        250: { pid: 250, sessionId: SESSION_B, kind: 'interactive' },
        301: { pid: 301, sessionId: SESSION_A, kind: 'interactive' }
      })
    ).resolves.toBe(SESSION_A)
  })

  it('ignores other terminals, headless children, and stale or malformed files', async () => {
    const rows = [row(100, 1, 100, 200), row(200, 100, 200, 200), row(900, 1, 900, 900)]

    await expect(
      resolve(rows, { 900: { pid: 900, sessionId: SESSION_A, kind: 'interactive' } })
    ).resolves.toBeNull()
    await expect(
      resolve(rows, { 200: { pid: 200, sessionId: SESSION_A, kind: 'print' } })
    ).resolves.toBeNull()
    await expect(resolve(rows, { 200: { pid: 7, sessionId: SESSION_A } })).resolves.toBeNull()
    await expect(resolve(rows, { 200: { pid: 200, sessionId: '../x' } })).resolves.toBeNull()
  })

  it('resolves nothing when the process table cannot be read', async () => {
    await expect(
      resolveClaudeLiveSessionIdUnderProcess(100, {
        readRows: async () => {
          throw new Error('unavailable')
        }
      })
    ).resolves.toBeNull()
  })
})
