import { BrowserWindow, ipcMain, Notification, powerMonitor, webContents } from 'electron'
import { browserManager } from '../browser/browser-manager'
import { readDesktopAwayState } from '../notifications/desktop-away-state'
import type { RuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import {
  getFocusedOrLastActiveMainWindow,
  getMainWindowForWebContents,
  getMainWindows
} from '../window/main-window-registry'
import { translateMain } from '../i18n/main-i18n'
import { encodeRepoIconPng } from './electron-repo-icon-png'
import { fetchRepoIconWithManualRedirects } from './electron-repo-icon-fetch'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../shared/sidebar-inputs-switch'

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  translateNotification: translateMain,
  isAwayForMobileNotifications: () => readDesktopAwayState(powerMonitor),
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  findFocusedOrLastActiveWindow: () => getFocusedOrLastActiveMainWindow(),
  countLiveWindows: () => getMainWindows().length,
  findWindowForBrowserPage: (browserPageId) => {
    const id = browserManager.getRendererWebContentsId(browserPageId)
    const renderer = id === null ? null : webContents.fromId(id)
    return renderer ? getMainWindowForWebContents(renderer) : null
  },
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  },
  // Switch point: only the phone's icon source encodes and fetches through these.
  ...(ORCA_SIDEBAR_INPUTS_IS_MAIN
    ? { encodeRepoIconPng, fetchRepoIcon: fetchRepoIconWithManualRedirects }
    : {})
}
