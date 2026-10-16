import { mkdtempSync, readFileSync, rmSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcessSync } from '../../shared/child-process/run-process'
import { migrateMainWorktree, verifyMainWorktreeMigration } from './main-worktree-migration'
import { applyMigrationJournal, readMainMigrationJournals } from './main-worktree-migration-journal'

const roots: string[] = []
function git(cwd: string, args: string[]): string {
  const result = runProcessSync({ program: 'git', args, cwd })
  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
  return result.stdout
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-main-migration-')))
  roots.push(root)
  const oldPath = join(root, 'original')
  git(root, ['init', oldPath])
  git(oldPath, ['config', 'user.name', 'Migration Test'])
  git(oldPath, ['config', 'user.email', 'migration@example.invalid'])
  writeFileSync(join(oldPath, 'file'), 'seed\n')
  git(oldPath, ['add', 'file'])
  git(oldPath, ['commit', '-m', 'seed'])
  const newPath = join(root, 'selected')
  const sibling = join(root, 'external')
  git(oldPath, ['worktree', 'add', newPath, '-b', 'selected'])
  git(oldPath, ['worktree', 'add', sibling, '-b', 'external'])
  writeFileSync(join(newPath, 'file'), 'selected\n')
  git(newPath, ['commit', '-am', 'selected commit'])
  git(oldPath, ['update-ref', 'refs/orca-test/keep', 'HEAD'])
  return {
    repoId: 'repo',
    oldPath,
    newPath,
    sibling,
    profileDirectory: join(root, 'profile'),
    force: false
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('original checkout migration', () => {
  it('preserves three checkout HEADs, indexes, reflogs and refs, then allows ordinary deletion', () => {
    const args = fixture()
    const index = readFileSync(
      join(git(args.newPath, ['rev-parse', '--absolute-git-dir']).trim(), 'index')
    )
    const reflog = git(args.newPath, ['reflog', '--format=%H'])
    const before = [args.oldPath, args.newPath, args.sibling].map((path) =>
      git(path, ['rev-parse', 'HEAD'])
    )
    const result = migrateMainWorktree(args)
    verifyMainWorktreeMigration(result.journal, result.worktrees)
    expect(
      [args.oldPath, args.newPath, args.sibling].map((path) => git(path, ['rev-parse', 'HEAD']))
    ).toEqual(before)
    expect(readFileSync(join(args.newPath, '.git', 'index'))).toEqual(index)
    expect(git(args.newPath, ['reflog', '--format=%H'])).toEqual(reflog)
    expect(git(args.sibling, ['rev-parse', 'refs/orca-test/keep'])).toBe(before[0])
    git(args.newPath, ['worktree', 'remove', args.oldPath])
    expect(existsSync(args.oldPath)).toBe(false)
    expect(git(args.sibling, ['status', '--porcelain'])).toBe('')
    writeFileSync(join(args.newPath, 'file'), 'after migration\n')
    git(args.newPath, ['commit', '-am', 'after migration'])
    git(args.newPath, ['worktree', 'add', join(args.profileDirectory, 'another'), '-b', 'another'])
  })

  it('recovers repeatedly after every publication boundary without changing HEADs', () => {
    const sample = fixture()
    const count = migrateMainWorktree(sample).journal.operations.length
    for (let interruptedAt = 0; interruptedAt < count; interruptedAt++) {
      const args = fixture()
      const before = git(args.newPath, ['rev-parse', 'HEAD'])
      expect(() =>
        migrateMainWorktree({
          ...args,
          afterStep: (step) => {
            if (step === interruptedAt) {
              throw new Error('interrupted')
            }
          }
        })
      ).toThrow('interrupted')
      const [{ path, journal }] = readMainMigrationJournals(args.profileDirectory)
      applyMigrationJournal(path, journal)
      applyMigrationJournal(path, journal)
      verifyMainWorktreeMigration(journal)
      expect(git(args.newPath, ['rev-parse', 'HEAD'])).toBe(before)
      expect(git(args.sibling, ['status', '--porcelain'])).toBe('')
    }
  }, 120_000)

  it('refuses dirty survivors even when force applies to the deleted checkout', () => {
    const args = fixture()
    writeFileSync(join(args.newPath, 'untracked'), 'keep')
    expect(() => migrateMainWorktree({ ...args, force: true })).toThrow('uncommitted changes')
    expect(git(args.sibling, ['status', '--porcelain'])).toBe('')
    expect(readMainMigrationJournals(args.profileDirectory)).toEqual([])
  })

  it('refuses altered pointers during interrupted recovery', () => {
    const args = fixture()
    expect(() =>
      migrateMainWorktree({
        ...args,
        afterStep: (step) => {
          if (step === 0) {
            throw new Error('interrupted')
          }
        }
      })
    ).toThrow('interrupted')
    const [{ path, journal }] = readMainMigrationJournals(args.profileDirectory)
    writeFileSync(join(args.sibling, '.git'), 'gitdir: /unrelated/repository\n')
    expect(() => applyMigrationJournal(path, journal)).toThrow('pointer changed')
    expect(readFileSync(join(args.sibling, '.git'), 'utf8')).toBe('gitdir: /unrelated/repository\n')
  })
})
