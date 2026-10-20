import { LocalPtyProvider } from '../../../providers/local-pty-provider'
import { getRuntimeDesktopSurface } from '../../../runtime/runtime-desktop-surface'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import type { PtyIpcSessionOptions, PtyRendererDelivery } from '../session'
import { localProvider } from '../provider/registry'
import {
  clearDidFinishLoadHandlerForWebContents,
  setDidFinishLoadHandler
} from '../provider/listener-lifecycle'
export function registerWindowOrphanSweep({
  mainWindow,
  runtime,
  options
}: {
  mainWindow?: PtyRendererDelivery
  runtime?: OrcaRuntimeService
  options?: PtyIpcSessionOptions
}): void {
  const rendererWebContents = mainWindow?.webContents
  // Why: only LocalPtyProvider PTYs (main-process) can be orphaned on reload; daemon sessions survive by design and cleanup would kill them.
  if (rendererWebContents) {
    clearDidFinishLoadHandlerForWebContents(rendererWebContents as Electron.WebContents)
  }
  if (mainWindow && localProvider instanceof LocalPtyProvider) {
    const lp = localProvider
    const finishLoadHandler = () => {
      // Why: always advance to keep the generation monotonic, but skip the sweep on crash/freeze-recovery reload — it would kill live local PTYs before session restore (#5787).
      const generation = lp.advanceGeneration()
      if (options?.isRecoveryReloadInFlight?.(rendererWebContents!.id)) {
        return
      }
      // Why: with several windows open the other renderers stay live, so only the
      // reloading window's own PTYs may be swept as orphans.
      const candidateIds =
        (getRuntimeDesktopSurface().countLiveWindows?.() ?? 0) > 1
          ? runtime?.resolvePtyIdsForOwnerWindow?.(mainWindow.id)
          : undefined
      // Why: the retained provider onExit callback is the only physical-exit proof; it clears ownership after the OS reaps it.
      lp.killOrphanedPtys(generation - 1, candidateIds)
    }
    setDidFinishLoadHandler(finishLoadHandler, rendererWebContents ?? null)
    rendererWebContents?.on('did-finish-load', finishLoadHandler)
    // Why: the sweep handler is keyed by webContents, so drop it when this window goes.
    mainWindow.once?.('closed', () => clearDidFinishLoadHandlerForWebContents(rendererWebContents!))
  }
}
