import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { fixture } from '../persistence/loading-store/profile-state-delayed-authority-fixture'
import { ProfileStateWriterError } from '../persistence/profile-state/profile-state-writer-errors'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  owned: new Set<string>(),
  partitioned: false
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler)
    ),
    on: vi.fn()
  }
}))
vi.mock('../window/window-view-state-registry', () => ({
  resolveWindowScopeForWebContents: vi.fn(() => null)
}))
vi.mock('../window/window-session-ownership', () => ({
  ownedSessionKeysForWindow: vi.fn(() => mocks.owned),
  hasWindowSessionPartition: vi.fn(() => mocks.partitioned)
}))
vi.mock('../window/project-window-session-focus', () => ({
  withProjectWindowFocus: vi.fn((s) => s)
}))

import { registerSessionHandlers } from './session'

const worktreeId = 'repo-1::/tmp/wt'
const tab = {
  id: 'tab-1',
  worktreeId,
  title: 'Terminal',
  ptyId: null,
  sortOrder: 0,
  createdAt: 1,
  customTitle: null,
  color: null
}

function session(): WorkspaceSessionState {
  return { ...getDefaultWorkspaceSession(), tabsByWorktree: { [worktreeId]: [tab] } }
}

async function setup(hostId: ExecutionHostId = 'local', current = session()) {
  const context = await fixture()
  context.store.setWorkspaceSession(current, hostId)
  await context.store.flushPendingOrThrowAsync()
  registerSessionHandlers(context.store)
  return {
    ...context,
    close: (tabId = 'tab-1', confirmed = false) =>
      mocks.handlers.get('session:closeTerminalTab')!(
        { sender: { id: 1 } },
        { worktreeId, tabId, confirmed },
        hostId
      )
  }
}

describe('session:closeTerminalTab', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.owned = new Set([worktreeId])
    mocks.partitioned = false
  })

  it.each(['local', 'ssh:build'] as const)(
    'waits for durable acknowledgement and preserves other host partitions on %s',
    async (hostId) => {
      const { store, authority, readState, close } = await setup(hostId)
      const otherHost = hostId === 'local' ? 'ssh:build' : 'local'
      store.setWorkspaceSession(session(), otherHost)
      await store.flushPendingOrThrowAsync()
      const write = vi.spyOn(store, 'setWorkspaceSession')
      const synchronousFlush = vi.spyOn(store, 'flushOrThrow')
      const gate = authority.pause()
      let acknowledged = false
      const pending = Promise.resolve(close()).then((result) => {
        acknowledged = true
        return result
      })
      await gate.started.promise
      expect(acknowledged).toBe(false)
      expect(store.getWorkspaceSession(hostId).tabsByWorktree[worktreeId]).toEqual([])
      gate.finish.resolve()
      await expect(pending).resolves.toEqual({ closed: true, pinned: false })
      expect(synchronousFlush).not.toHaveBeenCalled()
      const saved = readState()
      const target =
        hostId === 'local' ? saved.workspaceSession : saved.workspaceSessionsByHostId[hostId]
      const other =
        otherHost === 'local' ? saved.workspaceSession : saved.workspaceSessionsByHostId[otherHost]
      expect(target.tabsByWorktree[worktreeId]).toEqual([])
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ terminalTopologyRevisionByRepoId: { 'repo-1': 1 } }),
        hostId,
        mocks.owned
      )
      expect(other.tabsByWorktree[worktreeId]).toHaveLength(1)
    }
  )

  it('returns an empty session and ignores writes when every workspace belongs elsewhere', async () => {
    const { store } = await setup()
    mocks.partitioned = true
    mocks.owned.clear()
    const write = vi.spyOn(store, 'setWorkspaceSession')
    const patch = vi.spyOn(store, 'patchWorkspaceSession')
    const event = { sender: { id: 1 } }
    expect(mocks.handlers.get('session:get')!(event)).toMatchObject({ tabsByWorktree: {} })
    mocks.handlers.get('session:set')!(event, session())
    mocks.handlers.get('session:patch')!(event, { tabsByWorktree: {} })
    expect(write).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('checks window ownership after queuing without freezing subsequent writes', async () => {
    const { store, authority, close } = await setup()
    const gate = authority.pause()
    const predecessor = store.flushPendingOrThrowAsync()
    await gate.started.promise
    const rejected = expect(close()).rejects.toThrow('worktree_not_owned')
    mocks.partitioned = true
    mocks.owned.clear()
    gate.finish.resolve()
    await predecessor
    await rejected
    expect(store.getWorkspaceSession().tabsByWorktree[worktreeId]).toHaveLength(1)
    mocks.owned.add(worktreeId)
    await expect(close()).resolves.toEqual({ closed: true, pinned: false })
  })

  it.each(['known-failure', 'indeterminate'] as const)(
    'preserves later edits and handles %s write failure',
    async (outcome) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store, authority, close } = await setup()
      const gate = authority.pause()
      const rejected = expect(close()).rejects.toThrow('disk full')
      await gate.started.promise
      const current = store.getWorkspaceSession()
      current.tabsByWorktree[worktreeId]!.push({ ...tab, id: 'later-tab', title: 'Later' })
      gate.finish.reject(new ProfileStateWriterError('test-close', 'disk full', outcome))
      await rejected
      expect(store.getWorkspaceSession().tabsByWorktree[worktreeId]?.map((row) => row.id)).toEqual(
        outcome === 'known-failure' ? ['tab-1', 'later-tab'] : ['later-tab']
      )
    }
  )

  it('treats a missing tab idempotently and requires confirmation for pinned tabs', async () => {
    const current = session()
    current.tabsByWorktree[worktreeId] = [{ ...tab, isPinned: true }]
    const { store, close } = await setup('local', current)
    const write = vi.spyOn(store, 'setWorkspaceSession')
    await expect(close('missing')).resolves.toEqual({ closed: false, pinned: false })
    await expect(close()).resolves.toEqual({ closed: false, pinned: true })
    expect(write).not.toHaveBeenCalled()
    await expect(close('tab-1', true)).resolves.toEqual({ closed: true, pinned: false })
    expect(store.getWorkspaceSession().tabsByWorktree[worktreeId]).toEqual([])
  })
})
