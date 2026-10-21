import type { Store } from '../persistence'
import {
  WORKSPACE_SESSION_RELEASE_CHANNEL,
  type WorkspaceSessionReleasePayload
} from '../../shared/workspace-session-release'
import { collectWorkspaceSessionWorktreeKeys } from '../../shared/workspace-session-window-rebase'
import { getMainWindows, sendToWindow } from './main-window-registry'
import { hasWindowSessionPartition, ownedSessionKeysForWindow } from './window-session-ownership'

/**
 * Makes a project move live: every window is told which of the workspaces it is showing now
 * belong to someone else, so the window a project was opened from lets go of it without a reload.
 *
 * Derived from the *stored* session on purpose: main names only keys it knows, so a tab opened
 * seconds ago and not yet persisted is never yanked out of a window by a race. Being late is
 * recoverable, removing something nobody asked to remove is not.
 *
 * The other direction — a window *adopting* a project again when a project window closes or goes
 * free — is still a reload, and unchanged by this.
 */
export function publishWorkspaceSessionRelease(store: Store): void {
  const windows = getMainWindows()
  if (windows.length < 2) {
    return
  }
  const session = store.getWorkspaceSession()
  const allKeys = collectWorkspaceSessionWorktreeKeys(session)
  for (const window of windows) {
    const webContentsId = window.webContents.id
    const owned = ownedSessionKeysForWindow(store, webContentsId, session)
    if (!hasWindowSessionPartition(store, webContentsId, session)) {
      continue
    }
    const workspaceKeys = [...allKeys].filter((key) => !owned.has(key))
    if (workspaceKeys.length === 0) {
      continue
    }
    sendToWindow(window, WORKSPACE_SESSION_RELEASE_CHANNEL, {
      workspaceKeys
    } satisfies WorkspaceSessionReleasePayload)
  }
}
