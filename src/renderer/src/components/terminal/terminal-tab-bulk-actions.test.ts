import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeTerminalTab: vi.fn(),
  closeLocalTerminalTabState: vi.fn(),
  closeWebRuntimeSessionTab: vi.fn(),
  getState: vi.fn(),
  isWebRuntimeSessionActive: vi.fn(),
  reconcileTabOrder: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/lib/terminal-worktree-route', () => ({
  hasUnroutableTerminalWorktreeOwner: () => false,
  resolveTerminalWorktreeRoute: () => ({ runtimeEnvironmentId: 'host' })
}))
vi.mock('@/runtime/web-runtime-session-tab-lifecycle', () => ({
  closeWebRuntimeSessionTab: mocks.closeWebRuntimeSessionTab
}))
vi.mock('@/runtime/web-runtime-session-environment', () => ({
  isWebRuntimeSessionActive: mocks.isWebRuntimeSessionActive
}))
vi.mock('../tab-bar/reconcile-order', () => ({ reconcileTabOrder: mocks.reconcileTabOrder }))
vi.mock('./close-local-terminal-tab-state', () => ({
  closeLocalTerminalTabState: mocks.closeLocalTerminalTabState
}))
vi.mock('./terminal-tab-actions', () => ({ closeTerminalTab: mocks.closeTerminalTab }))

import { closeOtherTerminalTabs, closeTerminalTabsToRight } from './terminal-tab-bulk-actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isWebRuntimeSessionActive.mockReturnValue(false)
  mocks.reconcileTabOrder.mockReturnValue(['keep', 'close-a', 'pinned'])
  mocks.getState.mockReturnValue({
    tabsByWorktree: { 'wt-1': [{ id: 'keep' }, { id: 'close-a' }, { id: 'pinned' }] },
    unifiedTabsByWorktree: {
      'wt-1': [{ id: 'pinned', entityId: 'pinned', contentType: 'terminal', isPinned: true }]
    },
    openFiles: [],
    tabBarOrderByWorktree: {},
    setActiveTab: vi.fn()
  })
})

describe('terminal bulk close ownership', () => {
  it.each([
    ['other tabs', closeOtherTerminalTabs],
    ['tabs to the right', closeTerminalTabsToRight]
  ])(
    'routes %s through the durable single-tab close and preserves pinned tabs',
    (_label, close) => {
      close('keep', 'wt-1')

      expect(mocks.closeTerminalTab).toHaveBeenCalledExactlyOnceWith('close-a', {
        skipRunningProcessConfirm: true,
        rejectPinned: true
      })
      expect(mocks.closeLocalTerminalTabState).not.toHaveBeenCalled()
    }
  )

  it('sends remote closure to the owning host after pruning its local mirror', () => {
    mocks.isWebRuntimeSessionActive.mockReturnValue(true)

    closeOtherTerminalTabs('keep', 'wt-1')

    expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
    expect(mocks.closeLocalTerminalTabState).toHaveBeenCalledExactlyOnceWith('close-a', {
      remoteCloseOwnedByHost: true
    })
    expect(mocks.closeWebRuntimeSessionTab).toHaveBeenCalledExactlyOnceWith({
      worktreeId: 'wt-1',
      tabId: 'close-a',
      environmentId: 'host',
      reason: 'user'
    })
    expect(mocks.closeLocalTerminalTabState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeWebRuntimeSessionTab.mock.invocationCallOrder[0]
    )
  })
})
