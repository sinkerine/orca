import { readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { expect, test } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { getGoldenStubAgentLaunchEnv } from './helpers/golden-stub-agent'
import { focusActiveTerminalInput, waitForTerminalOutput } from './helpers/terminal'

type LaunchRecord = { argv: string[]; worktreeId: string; paneKey: string }

function readLaunches(file: string): LaunchRecord[] {
  try {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

test('paired server owns default, specific-agent and variant shortcut launches', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  const output = testInfo.outputPath('server-launches.jsonl')
  mkdirSync(path.dirname(output), { recursive: true })
  const host = await launchHeadlessPairedRuntimeHost()
  let client: PairedElectronClient | undefined
  try {
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' })
    await host.client.call('settings.update', {
      disabledTuiAgents: [],
      agentDefaultArgs: { codex: '--server-codex', claude: '--server-claude' },
      agentDefaultEnv: {
        codex: { ...getGoldenStubAgentLaunchEnv(), GOLDEN_STUB_AGENT_ARGV_LOG: output },
        claude: { ...getGoldenStubAgentLaunchEnv(), GOLDEN_STUB_AGENT_ARGV_LOG: output }
      }
    })
    const group = (
      await host.client.call<{ group: { id: string } }>('projectGroup.create', {
        name: 'Shortcut folder',
        parentPath: testRepoPath
      })
    ).result
    const folder = (
      await host.client.call<{ folderWorkspace: { id: string } }>('folderWorkspace.create', {
        projectGroupId: group.group.id,
        folderPath: testRepoPath,
        name: 'Remote folder'
      })
    ).result.folderWorkspace
    client = await launchPairedElectronClient(host.offer, testInfo, 'Shortcut server')
    const { page, environmentId } = client
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().allWorktrees().length ?? 0), {
        timeout: 60_000
      })
      .toBeGreaterThan(0)
    const worktreeId = await page.evaluate(() => window.__store!.getState().allWorktrees()[0].id)
    await page.evaluate(
      async ({ environmentId, agentEnv }) => {
        const state = window.__store!.getState()
        await state.updateSettings({
          agentDefaultEnv: { codex: agentEnv, claude: agentEnv },
          defaultTuiAgent: 'claude',
          disabledTuiAgents: [],
          experimentalNativeChat: false,
          openAgentTabsInChatByDefault: false,
          experimentalStructuredNativeChat: false,
          agentLaunchVariants: [
            {
              id: 'remote-variant',
              name: 'Remote variant',
              agent: 'codex',
              command: 'codex --variant-marker "two words"'
            }
          ]
        })
        await state.setKeybindingOverride('tab.newAgent', ['Mod+Shift+F6'])
        await state.setKeybindingOverride('tab.newAgent.claude', ['Mod+Shift+F7'])
        await state.setKeybindingOverride('tab.newAgentVariant.remote-variant', ['Mod+Shift+F8'])
        window.__store!.setState({
          detectedAgentIds: ['claude'],
          runtimeDetectedAgentIds: { ...state.runtimeDetectedAgentIds, [environmentId]: ['codex'] }
        })
      },
      {
        environmentId,
        agentEnv: { ...getGoldenStubAgentLaunchEnv(), GOLDEN_STUB_AGENT_ARGV_LOG: output }
      }
    )
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    for (const workspaceId of [worktreeId, `folder:${folder.id}`]) {
      await page.evaluate(async (id) => {
        const state = window.__store!.getState()
        await state.fetchRepos()
        state.setActiveView('terminal')
        state.setActiveWorktree(id)
        state.setActiveTabType('terminal')
      }, workspaceId)
      await expect
        .poll(() => page.evaluate(() => window.__store?.getState().activeWorktreeId))
        .toBe(workspaceId)
      await page.locator('[data-worktree-sidebar]').waitFor({ state: 'visible' })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const state = window.__store!.getState()
              return !!state.activeTabId && window.__paneManagers?.has(state.activeTabId)
            }),
          { timeout: 30_000 }
        )
        .toBe(true)
      await focusActiveTerminalInput(page)
      for (const [key, marker] of [
        ['F6', '--server-codex'],
        ['F7', '--server-claude'],
        ['F8', '--variant-marker']
      ] as const) {
        await page.evaluate((id) => {
          const store = window.__store!
          store.setState({
            detectedAgentIds: ['claude'],
            runtimeDetectedAgentIds: {
              ...store.getState().runtimeDetectedAgentIds,
              [id]: ['codex']
            }
          })
        }, environmentId)
        const before = readLaunches(output).length
        await page.keyboard.press(`${modifier}+Shift+${key}`)
        await expect.poll(() => readLaunches(output).length, { timeout: 30_000 }).toBe(before + 1)
        const record = readLaunches(output)[before]
        expect(record.argv).toContain(marker)
        expect(record.worktreeId).toBe(workspaceId)
        expect(record.paneKey).toBeTruthy()
        const serverTerminals = (
          await host.client.call<RuntimeTerminalListResult>('terminal.list', {
            worktree: `id:${workspaceId}`
          })
        ).result.terminals
        expect(serverTerminals).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              worktreeId: workspaceId,
              agentIdentity: key === 'F7' ? 'claude' : 'codex'
            })
          ])
        )
        if (key === 'F8') {
          expect(record.argv).toContain('two words')
          expect(record.argv).not.toContain('--server-codex')
        }
        await waitForTerminalOutput(page, 'GOLDEN_STUB_AGENT_READY', 30_000)
        await focusActiveTerminalInput(page)
        await page.screenshot({
          path: testInfo.outputPath(
            `${workspaceId === worktreeId ? 'worktree' : 'folder'}-${key}.png`
          )
        })
      }
    }
    expect(await client.getDirectSshAttemptTargetIds()).toEqual([])
  } finally {
    await client?.dispose()
    await host.dispose()
  }
})
