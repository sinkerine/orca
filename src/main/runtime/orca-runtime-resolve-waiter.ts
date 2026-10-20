import { OrcaRuntimeWithResolveExitWaiters } from './terminal/wait/terminal-wait-settlements'
import type { TerminalWaiter } from './runtime-terminal-contracts'
import type { RuntimeTerminalWait } from '../../shared/runtime-terminal-contracts'
import type { BrowserWindow } from 'electron'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'
import { rehomeTerminalTabWorktreeRecords } from './terminal-tab-worktree-rehome'

export abstract class OrcaRuntimeWithResolveWaiter extends OrcaRuntimeWithResolveExitWaiters {
  rehomeTerminalTabWorktree(tabId: string, worktreeId: string): { rehomedPtyIds: string[] } {
    const rehomedPtyIds = rehomeTerminalTabWorktreeRecords(
      { tabs: this.tabs, leaves: this.leaves, ptys: this.ptysById },
      tabId,
      worktreeId
    )
    for (const ptyId of rehomedPtyIds) {
      this.recordPtyWorktree(ptyId, worktreeId)
    }
    return { rehomedPtyIds }
  }
  protected resolveWaiter(waiter: TerminalWaiter, result: RuntimeTerminalWait): void {
    this.terminalWaiters.resolve(waiter, result)
  }

  protected rejectWaitersForHandle(handle: string, code: string): void {
    this.terminalWaiters.rejectHandle(handle, code)
  }

  protected rejectAllWaiters(code: string): void {
    this.terminalWaiters.rejectAll(code)
  }

  protected removeWaiter(waiter: TerminalWaiter): void {
    this.terminalWaiters.remove(waiter)
  }

  protected getLeafKey(tabId: string, leafId: string): string {
    return `${tabId}::${leafId}`
  }

  getAuthoritativeWindow(): BrowserWindow {
    const win = this.getAvailableAuthoritativeWindow()
    if (!win || win.isDestroyed()) {
      throw new Error('No renderer window available')
    }
    return win
  }

  protected getAvailableAuthoritativeWindow(): BrowserWindow | null {
    if (this.authoritativeWindowId === null) {
      return null
    }
    const win = getRuntimeDesktopSurface().findWindowById(this.authoritativeWindowId)
    return win && !win.isDestroyed() ? win : null
  }
}
