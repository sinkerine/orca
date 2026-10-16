import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'
import {
  refuseMainMigration as refuse,
  migrationPathContains as beneath,
  assertOrdinaryMigrationDirectory as ordinaryDirectory,
  assertOrdinaryMigrationMetadata as assertOrdinaryMetadata
} from './main-worktree-migration-preflight'
import { markMainMigrationUnavailable } from './main-worktree-migration-state'
import { assertNoGitActivityForMainMigration } from './main-worktree-migration-activity'
import {
  migrationGit as git,
  verifyMainWorktreeMigration
} from './main-worktree-migration-verification'
export { verifyMainWorktreeMigration } from './main-worktree-migration-verification'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { parseWorktreeList } from '../../shared/git-worktree-porcelain-parser'
import {
  applyMigrationJournal,
  mainMigrationJournalDirectory,
  migrationEntry,
  writeMigrationJournal,
  type MainWorktreeMigrationJournal
} from './main-worktree-migration-journal'

/** Synchronous publication keeps renderer/catalog callbacks outside the topology transition. */
export function migrateMainWorktree(args: {
  repoId: string
  oldPath: string
  newPath: string
  profileDirectory: string
  force: boolean
  afterStep?: (step: number) => void
}): { journalPath: string; journal: MainWorktreeMigrationJournal; worktrees: GitWorktreeInfo[] } {
  assertNoGitActivityForMainMigration()
  if (process.platform === 'win32') {
    refuse('original-checkout migration is not supported on Windows yet')
  }
  const { oldPath, newPath } = args
  ordinaryDirectory(oldPath)
  ordinaryDirectory(newPath)
  if (beneath(oldPath, newPath) || beneath(newPath, oldPath)) {
    refuse('migrating checkouts cannot contain each other')
  }
  const oldGit = join(oldPath, '.git')
  const newGit = join(newPath, '.git')
  ordinaryDirectory(oldGit)
  if (!lstatSync(newGit).isFile() || lstatSync(newGit).isSymbolicLink()) {
    refuse('the selected primary is not an ordinary linked checkout')
  }
  const newPointer = readFileSync(newGit, 'utf8')
  const match = /^gitdir: (.+)\n?$/.exec(newPointer.trimEnd())
  if (!match || !isAbsolute(match[1])) {
    refuse('relative Git administrative links are not supported')
  }
  const promotedAdmin = match[1]
  if (dirname(promotedAdmin) !== join(oldGit, 'worktrees')) {
    refuse('the selected primary belongs to another Git repository')
  }
  ordinaryDirectory(promotedAdmin)
  if (lstatSync(oldGit).dev !== lstatSync(newPath).dev) {
    refuse('the checkouts are on different filesystems')
  }
  const configuration = git(oldPath, ['config', '--list'])
  if (
    /^(?:include\.|includeif\.|extensions\.|core\.(?:worktree|hookspath|sparsecheckout|splitindex|fsmonitor)|remote\.[^=]+\.(?:url|pushurl)=\.{1,2}\/)/im.test(
      configuration
    )
  ) {
    refuse('relative paths, includes or worktree-specific configuration need manual migration')
  }
  for (const metadata of [
    'objects/info/alternates',
    'objects/info/http-alternates',
    'shallow',
    'info/sparse-checkout'
  ]) {
    if (existsSync(join(oldGit, metadata))) {
      refuse(`unsupported repository metadata: ${metadata}`)
    }
  }
  assertOrdinaryMetadata(oldGit, true)
  const worktrees = parseWorktreeList(git(oldPath, ['worktree', 'list', '--porcelain']))
  if (
    !worktrees.some((row) => row.path === oldPath && row.isMainWorktree) ||
    !worktrees.some((row) => row.path === newPath && !row.isMainWorktree)
  ) {
    refuse('Git checkout registrations changed')
  }
  const pointers: { path: string; before: string; admin: string }[] = []
  for (const row of worktrees) {
    if (row.isBare || row.prunable || row.locked) {
      refuse('all registered checkouts must be accessible and unlocked')
    }
    ordinaryDirectory(row.path)
    if (
      row.path !== oldPath &&
      row.path !== newPath &&
      (beneath(oldPath, row.path) || beneath(newPath, row.path))
    ) {
      refuse('a surviving checkout is nested inside a migrating checkout')
    }
    if (existsSync(join(row.path, '.gitmodules'))) {
      refuse('submodule repositories need manual migration')
    }
    if (row.path !== oldPath || !args.force) {
      if (git(row.path, ['status', '--porcelain', '--untracked-files=all']).trim()) {
        refuse('a checkout has uncommitted changes; commit or stash them first')
      }
    }
    if (row.path === oldPath) {
      continue
    }
    const pointerPath = join(row.path, '.git')
    if (lstatSync(pointerPath).isSymbolicLink()) {
      refuse('symlinked Git pointers are not supported')
    }
    const before = readFileSync(pointerPath, 'utf8')
    const pointer = /^gitdir: (.+)$/.exec(before.trimEnd())
    if (!pointer || !isAbsolute(pointer[1]) || dirname(pointer[1]) !== join(oldGit, 'worktrees')) {
      refuse('unsupported Git registration')
    }
    const admin = pointer[1]
    ordinaryDirectory(admin)
    if (
      readFileSync(join(admin, 'commondir'), 'utf8').trim() !== '../..' ||
      readFileSync(join(admin, 'gitdir'), 'utf8').trim() !== pointerPath
    ) {
      refuse('Git registration pointers disagree')
    }
    assertOrdinaryMetadata(admin)
    pointers.push({ path: pointerPath, before, admin })
  }
  const registrations = readdirSync(join(oldGit, 'worktrees'))
  if (registrations.length !== pointers.length) {
    refuse('some registered checkout could not be verified')
  }
  const promotedRefs = join(promotedAdmin, 'refs')
  if (existsSync(promotedRefs) && readdirSync(promotedRefs).length > 0) {
    refuse('checkout-local refs need manual migration')
  }
  for (const name of ['refs/worktree', 'refs/bisect', 'refs/rewritten']) {
    if (existsSync(join(oldGit, name))) {
      refuse('checkout-local refs need manual migration')
    }
  }
  const directory = mainMigrationJournalDirectory(args.profileDirectory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const token = randomUUID()
  const staging = join(dirname(oldPath), `.orca-main-migration-${token}`)
  mkdirSync(staging, { mode: 0o700 })
  if (lstatSync(staging).dev !== lstatSync(oldGit).dev) {
    rmSync(staging, { recursive: true })
    refuse('staging and Git metadata are on different filesystems')
  }
  let published = false
  try {
    const operations: MainWorktreeMigrationJournal['operations'] = []
    const move = (from: string, to: string) =>
      operations.push({ kind: 'move', from, to, entry: migrationEntry(from) })
    const write = (path: string, before: string | null, after: string) =>
      operations.push({ kind: 'write', path, before, after })
    const oldState = [
      'HEAD',
      'index',
      'logs/HEAD',
      'ORIG_HEAD',
      'FETCH_HEAD',
      'AUTO_MERGE',
      'COMMIT_EDITMSG'
    ]
    for (const name of oldState) {
      if (existsSync(join(oldGit, name))) {
        move(join(oldGit, name), join(staging, 'old', name))
      }
    }
    const promotedNames = readdirSync(promotedAdmin).filter(
      (name) => !['commondir', 'gitdir', 'locked', 'logs', 'refs'].includes(name)
    )
    if (existsSync(join(promotedAdmin, 'logs', 'HEAD'))) {
      promotedNames.push('logs/HEAD')
    }
    for (const name of promotedNames) {
      move(join(promotedAdmin, name), join(staging, 'promoted', name))
    }
    move(newGit, join(staging, 'pointer'))
    move(oldGit, newGit)
    const demotedAdmin = join(newGit, 'worktrees', `orca-former-main-${token}`)
    for (const name of oldState) {
      const op = operations.find(
        (entry) => entry.kind === 'move' && entry.to === join(staging, 'old', name)
      )
      if (op?.kind === 'move') {
        operations.push({
          kind: 'move',
          from: op.to,
          to: join(demotedAdmin, name),
          entry: op.entry
        })
      }
    }
    for (const name of promotedNames) {
      const op = operations.find(
        (entry) => entry.kind === 'move' && entry.to === join(staging, 'promoted', name)
      )
      if (op?.kind === 'move') {
        operations.push({ kind: 'move', from: op.to, to: join(newGit, name), entry: op.entry })
      }
    }
    write(join(demotedAdmin, 'commondir'), null, '../..\n')
    write(join(demotedAdmin, 'gitdir'), null, `${oldGit}\n`)
    write(oldGit, null, `gitdir: ${demotedAdmin}\n`)
    for (const pointer of pointers) {
      if (pointer.admin === promotedAdmin) {
        continue
      }
      write(
        pointer.path,
        pointer.before,
        `gitdir: ${join(newGit, 'worktrees', relative(join(oldGit, 'worktrees'), pointer.admin))}\n`
      )
    }
    const emptyAdmin = join(newGit, 'worktrees', relative(join(oldGit, 'worktrees'), promotedAdmin))
    operations.push({
      kind: 'move',
      from: emptyAdmin,
      to: join(staging, 'registration'),
      entry: migrationEntry(promotedAdmin)
    })
    const journal: MainWorktreeMigrationJournal = {
      version: 1,
      repoId: args.repoId,
      oldPath,
      newPath,
      staging,
      operations,
      next: 0
    }
    const journalPath = join(directory, `${token}.json`)
    writeMigrationJournal(journalPath, journal)
    published = true
    try {
      applyMigrationJournal(journalPath, journal, args.afterStep)
      verifyMainWorktreeMigration(journal, worktrees)
    } catch (error) {
      if (args.afterStep) {
        throw error
      }
      try {
        applyMigrationJournal(journalPath, journal)
        verifyMainWorktreeMigration(journal, worktrees)
      } catch (recoveryError) {
        markMainMigrationUnavailable(
          worktrees.map((row) => row.path),
          `${journalPath}: ${String(recoveryError)}`
        )
        throw new Error(
          `Git migration needs attention. Its recovery journal is ${journalPath}. No checkout was deleted. ${String(error)}`
        )
      }
    }
    return { journalPath, journal, worktrees }
  } finally {
    if (!published) {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}
