import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { Store } from '../persistence'
import type { RuntimeNotifier } from '../runtime/runtime-notifier-contract'

export type MockFn = Mock<(...args: never[]) => unknown>

export type RuntimeStub = {
  attachWindow: MockFn
  setNotifier: Mock<(notifier: RuntimeNotifier | null) => void>
  markRendererReloading: MockFn
  markRendererReloadCancelled: MockFn
  markGraphReloadFailed: MockFn
  markGraphUnavailable: MockFn
  resolveOwnerWindowIdForTabId: MockFn
  resolveOwnerWindowIdForWorktreeTab: MockFn
  resolveOwnerWindowIdForLeaf: MockFn
  resolveOwnerWindowIdForPtyId: MockFn
  resolveOwnerWindowIdForBrowserPageId: MockFn
  registerPtyOwnerWindow: MockFn
}

export function createStore(): Store & { flushPendingAsync: MockFn } {
  const store = {
    getProfileStorageDirectory: vi.fn(() => '/profile-a'),
    getSshTargets: vi.fn(() => []),
    flushPendingAsync: vi.fn(() => Promise.resolve())
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: notifier tests mock service registration; only these store reads and flush are exercised.
  return store as unknown as Store & { flushPendingAsync: MockFn }
}

export function createRuntime(): RuntimeStub {
  return {
    attachWindow: vi.fn(),
    setNotifier: vi.fn(),
    markRendererReloading: vi.fn(),
    markRendererReloadCancelled: vi.fn(),
    markGraphReloadFailed: vi.fn(),
    markGraphUnavailable: vi.fn(),
    // Why: relays resolve the owning window before sending; null means "no owner yet",
    // which routes to the window in front — the single-window behavior most tests assert.
    resolveOwnerWindowIdForTabId: vi.fn(() => null),
    resolveOwnerWindowIdForWorktreeTab: vi.fn(() => null),
    resolveOwnerWindowIdForLeaf: vi.fn(() => null),
    resolveOwnerWindowIdForPtyId: vi.fn(() => null),
    resolveOwnerWindowIdForBrowserPageId: vi.fn(() => null),
    registerPtyOwnerWindow: vi.fn()
  }
}

export function getClosedHandlers(mainWindowOnMock: MockFn): (() => void)[] {
  return mainWindowOnMock.mock.calls
    .filter(([event]) => event === 'closed')
    .map(([, handler]) => handler as () => void)
}
