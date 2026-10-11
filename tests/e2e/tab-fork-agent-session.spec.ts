/** E2E coverage for the tab context menu's "Fork session in new tab" action. */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { configureGoldenStubAgent, getGoldenStubAgentLaunchEnv } from './helpers/golden-stub-agent'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type StubLaunch = { argv: string[]; paneKey: string; worktreeId: string; launchToken: string }

const SOURCE_SESSION_ID = 'e2e-fork-source-session'
const FORKED_SESSION_ID = 'e2e-fork-branch-session'
// The stub is launched through an alias-like override, so identity can only come from hooks.
const BASE_ARGV = ['--profile', 'fast']

function readStubLaunches(logPath: string): StubLaunch[] {
  return existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StubLaunch)
    : []
}

async function waitForStubLaunch(logPath: string, count: number): Promise<StubLaunch> {
  await expect
    .poll(() => readStubLaunches(logPath).length, {
      timeout: 45_000,
      message: `Expected ${count} stub agent launch(es)`
    })
    .toBe(count)
  return readStubLaunches(logPath)[count - 1]
}

/** Reports a provider session the way the agent's own hook would, launch token included. */
async function reportCodexSession(
  app: ElectronApplication,
  page: Page,
  launch: StubLaunch,
  sessionId: string
): Promise<void> {
  const endpoint = await readHookEndpoint(app)
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/codex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
    body: JSON.stringify({
      paneKey: launch.paneKey,
      tabId: launch.paneKey.split(':')[0],
      worktreeId: launch.worktreeId,
      launchToken: launch.launchToken,
      env: endpoint.env,
      version: endpoint.version,
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'work', session_id: sessionId }
    })
  })
  expect(response.status).toBe(204)
  await expect
    .poll(() =>
      page.evaluate(
        (paneKey) => window.__store?.getState().agentStatusByPaneKey[paneKey]?.providerSession?.id,
        launch.paneKey
      )
    )
    .toBe(sessionId)
}

async function forkFromTabContextMenu(page: Page, tabId: string): Promise<void> {
  await page
    .locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    .click({ button: 'right', force: true })
  const forkItems = page.getByRole('menuitem', { name: /fork/i })
  await expect(forkItems).toHaveCount(1)
  await expect(forkItems).toHaveText(/Fork session in new tab/)
  await expect(forkItems).not.toHaveAttribute('data-disabled')
  await forkItems.click({ force: true })
}

test('forks the running agent session from the tab context menu, across forks and restart', async (// oxlint-disable-next-line no-empty-pattern -- Playwright's second fixture arg is testInfo; the first must be an object destructure to opt out of the default fixture set.
{}, testInfo) => {
  const repoPath = readFileSync(TEST_REPO_PATH_FILE, 'utf-8').trim()
  if (!repoPath || !existsSync(repoPath)) {
    test.skip(true, 'Global setup did not produce a seeded test repo')
    return
  }
  test.setTimeout(240_000)

  const logDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-fork-'))
  const logPath = path.join(logDir, 'stub-launches.jsonl')
  const session = createRestartSession(testInfo, {
    ...(getGoldenStubAgentLaunchEnv() as Record<string, string>),
    GOLDEN_STUB_AGENT_ARGV_LOG: logPath
  })
  let app: ElectronApplication | null = null

  try {
    const firstLaunch = await session.launch()
    app = firstLaunch.app
    const page = firstLaunch.page
    await attachRepoAndOpenTerminal(page, repoPath)
    await waitForSessionReady(page)
    await waitForActiveWorktree(page)
    await ensureTerminalVisible(page)
    await configureGoldenStubAgent(page, { agent: 'codex', agentArgs: BASE_ARGV.join(' ') })

    await page.getByRole('button', { name: 'New tab' }).click({ force: true })
    await page
      .getByRole('menuitem', { name: /^Codex(?:\s|$)/i })
      .first()
      .click({ force: true })
    const source = await waitForStubLaunch(logPath, 1)
    expect(source.argv).toEqual(BASE_ARGV)
    const sourceTabId = source.paneKey.split(':')[0]

    // A tab with no reported provider session has nothing to fork.
    await page
      .locator(`[data-testid="sortable-tab"][data-tab-id="${sourceTabId}"]`)
      .click({ button: 'right', force: true })
    await expect(page.getByRole('menuitem', { name: /fork/i })).toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')

    await reportCodexSession(app, page, source, SOURCE_SESSION_ID)
    await forkFromTabContextMenu(page, sourceTabId)
    const fork = await waitForStubLaunch(logPath, 2)
    // Launch args appear exactly once, followed by the fork argv.
    expect(fork.argv).toEqual([...BASE_ARGV, 'fork', SOURCE_SESSION_ID])
    expect(fork.paneKey).not.toBe(source.paneKey)

    // Forking the fork must start from the plain base command, not replay the first fork.
    await reportCodexSession(app, page, fork, FORKED_SESSION_ID)
    await forkFromTabContextMenu(page, fork.paneKey.split(':')[0])
    const nestedFork = await waitForStubLaunch(logPath, 3)
    expect(nestedFork.argv).toEqual([...BASE_ARGV, 'fork', FORKED_SESSION_ID])

    await session.close(app)
    app = null
    const secondLaunch = await session.launch()
    app = secondLaunch.app
    await waitForSessionReady(secondLaunch.page)
    await ensureTerminalVisible(secondLaunch.page)

    // The restored tab still knows its provider session without any new hook event.
    await forkFromTabContextMenu(secondLaunch.page, sourceTabId)
    const afterRestart = await waitForStubLaunch(logPath, 4)
    expect(afterRestart.argv).toEqual([...BASE_ARGV, 'fork', SOURCE_SESSION_ID])
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    rmSync(logDir, { recursive: true, force: true })
  }
})
