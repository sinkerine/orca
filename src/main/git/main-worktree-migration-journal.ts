import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const Entry = z.object({ dev: z.number(), ino: z.number(), digest: z.string().optional() })
const Operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), from: z.string(), to: z.string(), entry: Entry }),
  z.object({
    kind: z.literal('write'),
    path: z.string(),
    before: z.string().nullable(),
    after: z.string()
  })
])
export const MigrationJournal = z.object({
  version: z.literal(1),
  repoId: z.string(),
  oldPath: z.string(),
  newPath: z.string(),
  staging: z.string(),
  operations: z.array(Operation),
  next: z.number().int().nonnegative()
})
export type MainWorktreeMigrationJournal = z.infer<typeof MigrationJournal>

export function migrationEntry(path: string): z.infer<typeof Entry> {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error(`Unsupported Git metadata entry: ${path}`)
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    ...(stat.isFile()
      ? { digest: createHash('sha256').update(readFileSync(path)).digest('hex') }
      : {})
  }
}

function matches(path: string, expected: z.infer<typeof Entry>): boolean {
  if (!existsSync(path)) {
    return false
  }
  const actual = migrationEntry(path)
  return (
    actual.dev === expected.dev && actual.ino === expected.ino && actual.digest === expected.digest
  )
}

function syncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch {
    // Some filesystems do not support directory fsync.
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

export function writeMigrationJournal(path: string, value: MainWorktreeMigrationJournal): void {
  const temporary = `${path}.tmp`
  const fd = openSync(temporary, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  syncDirectory(dirname(path))
}

/** Every step recognizes its own completed state after an interrupted journal update. */
export function applyMigrationJournal(
  path: string,
  journal: MainWorktreeMigrationJournal,
  afterStep?: (step: number) => void
): void {
  for (; journal.next < journal.operations.length;) {
    const operation = journal.operations[journal.next]
    if (operation.kind === 'move') {
      if (!matches(operation.to, operation.entry)) {
        if (existsSync(operation.to) || !matches(operation.from, operation.entry)) {
          throw new Error(`Git migration recovery needs attention: ${operation.from}`)
        }
        mkdirSync(dirname(operation.to), { recursive: true })
        renameSync(operation.from, operation.to)
        syncDirectory(dirname(operation.from))
        syncDirectory(dirname(operation.to))
      }
    } else {
      const current = existsSync(operation.path) ? readFileSync(operation.path, 'utf8') : null
      if (current !== operation.after) {
        if (
          current !== operation.before ||
          (existsSync(operation.path) && lstatSync(operation.path).isSymbolicLink())
        ) {
          throw new Error(`Git migration pointer changed: ${operation.path}`)
        }
        const temporary = `${operation.path}.orca-migration-tmp`
        const fd = openSync(temporary, 'w', 0o600)
        try {
          writeFileSync(fd, operation.after)
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
        renameSync(temporary, operation.path)
        syncDirectory(dirname(operation.path))
      }
    }
    afterStep?.(journal.next)
    journal.next += 1
    writeMigrationJournal(path, journal)
  }
}

export function mainMigrationJournalDirectory(profileDirectory: string): string {
  return join(profileDirectory, 'main-worktree-migrations')
}

export function readMainMigrationJournals(
  profileDirectory: string
): { path: string; journal: MainWorktreeMigrationJournal }[] {
  const directory = mainMigrationJournalDirectory(profileDirectory)
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const path = join(directory, name)
      try {
        return { path, journal: MigrationJournal.parse(JSON.parse(readFileSync(path, 'utf8'))) }
      } catch (error) {
        console.error(
          '[git-migration] Invalid recovery journal; leaving it untouched:',
          path,
          error
        )
        return null
      }
    })
    .filter(
      (entry): entry is { path: string; journal: MainWorktreeMigrationJournal } => entry !== null
    )
}

export function finishMigrationJournal(path: string, journal: MainWorktreeMigrationJournal): void {
  // Staging holds only the displaced pointer and the promoted checkout's emptied registration.
  rmSync(journal.staging, { recursive: true, force: true })
  rmSync(path, { force: true })
  syncDirectory(dirname(path))
}
