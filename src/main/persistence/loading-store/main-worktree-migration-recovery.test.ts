import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcessSync } from '../../../shared/child-process/run-process'
import { migrateMainWorktree } from '../../git/main-worktree-migration'
import { readMainMigrationJournals } from '../../git/main-worktree-migration-journal'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))
import { createStore, testState, writeDataFile } from '../../persistence-test-harness'

function git(cwd: string, args: string[]): string {
  const result = runProcessSync({ program: 'git', args, cwd })
  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
  return result.stdout
}
afterEach(() => {
  rmSync(testState.dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')(
  'main checkout recovery before store hydration',
  () => {
    it.each([false, true])(
      'recovers before hydration or retains an unavailable repository when pointers changed (%s)',
      (tampered) => {
        testState.dir = realpathSync(mkdtempSync(join(tmpdir(), 'orca-main-store-recovery-')))
        const oldPath = join(testState.dir, 'original')
        const newPath = join(testState.dir, 'selected')
        git(testState.dir, ['init', oldPath])
        git(oldPath, ['config', 'user.name', 'Test'])
        git(oldPath, ['config', 'user.email', 'test@example.invalid'])
        writeFileSync(join(oldPath, 'file'), 'seed')
        git(oldPath, ['add', 'file'])
        git(oldPath, ['commit', '-m', 'seed'])
        git(oldPath, ['worktree', 'add', newPath, '-b', 'selected'])
        const repo = {
          id: 'repo',
          path: oldPath,
          displayName: 'repo',
          badgeColor: '#737373',
          addedAt: 1,
          kind: 'git'
        }
        const worktreeId = `repo::${newPath}`
        writeDataFile({
          repos: [repo],
          worktreeMeta: {
            [worktreeId]: { instanceId: 'keep-instance', hostId: 'local', displayName: 'selected' }
          }
        })
        const originalStore = createStore()
        originalStore.flushOrThrow()
        expect(() =>
          migrateMainWorktree({
            repoId: repo.id,
            oldPath,
            newPath,
            profileDirectory: testState.dir,
            force: false,
            afterStep: (step) => {
              if (step === 1) {
                throw new Error('interrupted')
              }
            }
          })
        ).toThrow('interrupted')
        if (tampered) {
          writeFileSync(
            join(oldPath, '.git', 'worktrees', 'selected', 'gitdir'),
            '/changed-by-user/.git\n'
          )
          // A planned move must not overwrite an unexpected target.
          writeFileSync(join(testState.dir, 'unexpected'), 'keep')
          const [{ journal }] = readMainMigrationJournals(testState.dir)
          const next = journal.operations[journal.next]
          if (next.kind === 'move') {
            writeFileSync(next.from, 'external edit')
          }
          expect(() => createStore()).not.toThrow()
          expect(readMainMigrationJournals(testState.dir)).toHaveLength(1)
          return
        }
        const recovered = createStore()
        expect(recovered.getRepo('repo')?.path).toBe(newPath)
        expect(
          recovered.getProjectHostSetups().find((entry) => entry.repoId === repo.id)?.path
        ).toBe(newPath)
        expect(recovered.getWorktreeMeta(worktreeId)?.instanceId).toBe('keep-instance')
        expect(readMainMigrationJournals(testState.dir)).toEqual([])
        expect(createStore().getRepo('repo')?.path).toBe(newPath)
        git(newPath, ['worktree', 'remove', oldPath])
        expect(existsSync(oldPath)).toBe(false)
        expect(git(newPath, ['status', '--porcelain'])).toBe('')
      }
    )
  }
)
