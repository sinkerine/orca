import { existsSync, mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { runProcessSync } from '../../src/shared/child-process/run-process'

function git(cwd: string, args: string[]): string {
  const result = runProcessSync({ program: 'git', args, cwd, timeoutMs: 30_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
  return result.stdout
}

// oxlint-disable-next-line no-empty-pattern -- Owns restart lifecycle.
test('deletes the original checkout after selecting a linked primary and retains it after restart', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'Original checkout migration requires native POSIX paths')
  test.setTimeout(180_000)
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-former-primary-e2e-')))
  const original = path.join(root, 'original')
  const selected = path.join(root, 'selected')
  const sibling = path.join(root, 'external')
  git(root, ['init', original])
  git(original, ['config', 'user.name', 'Orca E2E'])
  git(original, ['config', 'user.email', 'orca-e2e@example.invalid'])
  writeFileSync(path.join(original, 'file'), 'seed')
  git(original, ['add', 'file'])
  git(original, ['commit', '-m', 'seed'])
  git(original, ['worktree', 'add', selected, '-b', 'selected-primary'])
  git(original, ['worktree', 'add', sibling, '-b', 'external-sibling'])
  const restart = createRestartSession(testInfo)
  let app: Awaited<ReturnType<typeof restart.launch>>['app'] | null = null
  try {
    const first = await restart.launch()
    app = first.app
    await waitForSessionReady(first.page)
    const originalId = await attachRepoAndOpenTerminal(first.page, original)
    await first.page.evaluate(async () => {
      const state = window.__store!.getState()
      state.setShowSleepingWorkspaces(true)
      await state.updateSettings({ compactWorktreeCards: false })
    })
    const selectedCard = first.page
      .locator('[data-worktree-id]')
      .filter({ hasText: 'selected-primary' })
      .first()
    await selectedCard.click({ button: 'right' })
    await first.page.getByRole('menuitem', { name: 'Set as primary', exact: true }).click()
    await expect(selectedCard.getByText('primary', { exact: true })).toBeVisible()
    const originalCard = first.page.locator(`[data-worktree-id="${originalId}"]`).first()
    await originalCard.click({ button: 'right' })
    const deleteAction = first.page.getByRole('menuitem', { name: /^Delete(?:\s|$)/ })
    await expect(deleteAction).toBeEnabled()
    await deleteAction.click()
    const dialog = first.page.getByRole('dialog')
    await expect(dialog.getByText(/Git data will move/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete Workspace', exact: true }).click()
    await expect(originalCard).toHaveCount(0)
    await expect(selectedCard.getByText('primary', { exact: true })).toBeVisible()
    expect(existsSync(original)).toBe(false)
    expect(git(sibling, ['status', '--porcelain'])).toBe('')
    expect(git(selected, ['rev-parse', '--git-common-dir']).trim()).toBe('.git')
    await restart.close(app)
    app = null
    const second = await restart.launch()
    app = second.app
    await waitForSessionReady(second.page)
    await expect(
      second.page
        .locator('[data-worktree-id]')
        .filter({ hasText: 'selected-primary' })
        .first()
        .getByText('primary', { exact: true })
    ).toBeVisible()
    expect(git(sibling, ['status', '--porcelain'])).toBe('')
  } finally {
    if (app) {
      await restart.close(app)
    }
    await restart.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})
