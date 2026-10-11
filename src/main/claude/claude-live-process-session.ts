import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { getStrictProcessTableSnapshot } from '../../shared/process-table-snapshot-reader'

const SESSION_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export type ClaudeLiveProcessSessionDeps = {
  readRows?: () => Promise<ProcessTableRow[]>
  readSessionFile?: (pid: number) => Promise<string>
}

function claudeSessionFilePath(pid: number): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
  return join(configDir, 'sessions', `${pid}.json`)
}

/** Pids under `rootPid`, the terminal's foreground process group first, then shallowest. */
function descendantPidsForegroundFirst(
  rows: readonly ProcessTableRow[],
  rootPid: number
): number[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>()
  for (const row of rows) {
    const siblings = childrenByParent.get(row.ppid)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenByParent.set(row.ppid, [row])
    }
  }
  const foregroundPgid = rows.find((row) => row.pid === rootPid)?.tpgid
  const descendants: ProcessTableRow[] = []
  const seen = new Set<number>([rootPid])
  let frontier = [rootPid]
  while (frontier.length > 0) {
    const next: number[] = []
    for (const parent of frontier) {
      for (const child of childrenByParent.get(parent) ?? []) {
        if (!seen.has(child.pid)) {
          seen.add(child.pid)
          descendants.push(child)
          next.push(child.pid)
        }
      }
    }
    frontier = next
  }
  const isForeground = (row: ProcessTableRow): boolean =>
    foregroundPgid !== undefined && foregroundPgid > 0 && row.pgid === foregroundPgid
  return [
    ...descendants.filter(isForeground),
    ...descendants.filter((row) => !isForeground(row))
  ].map((row) => row.pid)
}

function parseInteractiveSessionId(raw: string, pid: number): string | null {
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; sessionId?: unknown; kind?: unknown }
    if (parsed.pid !== pid || typeof parsed.sessionId !== 'string') {
      return null
    }
    // Why: headless `claude -p` children also write a session file; only the TUI is forkable.
    if (parsed.kind !== undefined && parsed.kind !== 'interactive') {
      return null
    }
    return SESSION_ID_PATTERN.test(parsed.sessionId) ? parsed.sessionId : null
  } catch {
    return null
  }
}

/**
 * Session id of the interactive Claude running under a terminal's root process.
 *
 * Why: Claude records `sessions/<pid>.json` for every live process, so this works when Orca's
 * hooks cannot be installed (read-only settings.json) and for aliased or wrapped launches.
 */
export async function resolveClaudeLiveSessionIdUnderProcess(
  rootPid: number,
  deps: ClaudeLiveProcessSessionDeps = {}
): Promise<string | null> {
  const readRows = deps.readRows ?? getStrictProcessTableSnapshot
  const readSessionFile =
    deps.readSessionFile ?? ((pid: number) => readFile(claudeSessionFilePath(pid), 'utf8'))
  let rows: ProcessTableRow[]
  try {
    rows = await readRows()
  } catch {
    return null
  }
  for (const pid of descendantPidsForegroundFirst(rows, rootPid)) {
    const raw = await readSessionFile(pid).catch(() => null)
    const sessionId = raw === null ? null : parseInteractiveSessionId(raw, pid)
    if (sessionId) {
      return sessionId
    }
  }
  return null
}
