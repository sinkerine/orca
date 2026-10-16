import { join, resolve } from 'node:path'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { parseWorktreeList } from '../../shared/git-worktree-porcelain-parser'
import { runProcessSync } from '../../shared/child-process/run-process'
import type { MainWorktreeMigrationJournal } from './main-worktree-migration-journal'

export function migrationGit(cwd: string, args: string[]): string {
  const result = runProcessSync({ program: 'git', args, cwd, timeoutMs: 30_000 })
  if (result.code !== 0 || result.outputTruncated) {
    throw new Error(`Git checkout migration failed: ${result.stderr || args.join(' ')}`)
  }
  return result.stdout
}

export function verifyMainWorktreeMigration(
  journal: MainWorktreeMigrationJournal,
  before?: GitWorktreeInfo[]
): void {
  const rows = parseWorktreeList(migrationGit(journal.newPath, ['worktree', 'list', '--porcelain']))
  if (
    rows.filter((row) => row.isMainWorktree).length !== 1 ||
    !rows.some((row) => row.path === journal.newPath && row.isMainWorktree)
  ) {
    throw new Error('Git checkout migration did not publish the new main checkout')
  }
  for (const row of rows) {
    const previous = before?.find((entry) => entry.path === row.path)
    if (before && (!previous || previous.head !== row.head || previous.branch !== row.branch)) {
      throw new Error('Git checkout migration changed a checkout HEAD')
    }
    if (
      resolve(row.path, migrationGit(row.path, ['rev-parse', '--git-common-dir']).trim()) !==
      join(journal.newPath, '.git')
    ) {
      throw new Error('Git checkout migration left an invalid common directory')
    }
  }
  if (before && rows.length !== before.length) {
    throw new Error('Git checkout migration changed registrations')
  }
}
