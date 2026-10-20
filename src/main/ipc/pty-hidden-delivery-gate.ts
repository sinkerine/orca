/**
 * Main-side hidden-delivery gate for renderer PTY byte delivery (Phase 4 of
 * the terminal model/view architecture).
 *
 * The renderer marks a PTY hidden when no visible view consumes its bytes;
 * main then drops renderer-bound delivery AFTER model ingestion — the runtime
 * already parsed the chunk, and reveal restores from the model snapshot via
 * the existing seq-guarded machinery. Any renderer party that still needs raw
 * bytes (dispatcher sidecars) registers delivery
 * interest, which suppresses the gate for that PTY.
 */
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  clearRendererPtyWindowClaims,
  clearRendererPtyWindowClaimsForPty,
  countRendererPtyDeliveryInterest,
  getHiddenRendererPtyIdsAcrossWindows,
  hasRendererPtyDeliveryInterest,
  IMPLICIT_RENDERER_WINDOW_ID,
  isHiddenForEveryClaimingWindow,
  isHiddenRendererPtyInAnyWindow,
  recordHiddenRendererPtyWindowClaim,
  recordRendererPtyDeliveryInterestWindowClaim,
  resetAllRendererPtyWindowClaims
} from './pty/delivery/renderer-pty-window-claims'

export type HiddenPtyDeliveryGateSettings = Pick<
  GlobalSettings,
  'terminalMainSideEffectAuthority' | 'terminalHiddenDeliveryGate'
>

// Why: reveal must restore from the model only when bytes were actually
// dropped. Doubles as the marker latch: the first gated drop emits a restore
// marker and every unhide re-emits one. It retires only when the renderer acks
// the restore painted, or on PTY teardown — a retiring hidden pane unhides after
// unregistering its marker handler, so spending it on unhide loses the gap.
// 'awaiting-paint' = an unhide re-emitted the marker; a drop after that starts a
// new episode the in-flight restore's snapshot may predate, so its ack must not
// retire it.
const droppedSinceHiddenPtys = new Map<
  string,
  { state: 'unrevealed' | 'awaiting-paint'; episode: number }
>()
let nextHiddenDropEpisode = 1
// Why: a runtime background spawn has no renderer party to re-mark it after a
// reload/crash, so its hidden mark must outlive renderer-scoped resets until a
// renderer unmarks it (visible mount) or the PTY is torn down.
const runtimeOwnedHiddenRendererPtys = new Set<string>()

let droppedHiddenDeliveryChars = 0
let droppedHiddenDeliveryChunks = 0

/** Gate kill switches, both read main-side: the gate only operates under main
 *  side-effect authority AND the gate-specific setting (both default on). */
export function isHiddenPtyDeliveryGateEnabled(
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    settings?.terminalMainSideEffectAuthority !== false &&
    settings?.terminalHiddenDeliveryGate !== false
  )
}

/** Renderer-reported "no visible view needs bytes" bit. Never clears drop
 *  memory: a hidden remount or renderer reload re-marks an already-dropped
 *  PTY, and erasing the latch there would make the eventual reveal skip the
 *  restore. */
export function markHiddenRendererPty(id: string, windowId = IMPLICIT_RENDERER_WINDOW_ID): void {
  recordHiddenRendererPtyWindowClaim(windowId, id, true)
}

/** Clears the hidden bit. Returns whether bytes were dropped while hidden so
 *  the caller can emit a restore marker. Reads the latch without spending it:
 *  the marker may reach no handler (see droppedSinceHiddenPtys). */
export function unmarkHiddenRendererPty(id: string, windowId = IMPLICIT_RENDERER_WINDOW_ID): {
  droppedWhileHidden: boolean
  hiddenDropEpisode?: number
} {
  recordHiddenRendererPtyWindowClaim(windowId, id, false)
  runtimeOwnedHiddenRendererPtys.delete(id)
  const latch = droppedSinceHiddenPtys.get(id)
  if (!latch) {
    return { droppedWhileHidden: false }
  }
  latch.state = 'awaiting-paint'
  return { droppedWhileHidden: true, hiddenDropEpisode: latch.episode }
}

/** Retires drop memory once the renderer reports painting a restore requested
 *  for this episode. An older restore's ack must not retire a newer episode,
 *  and an ack naming no episode retires nothing (fails toward recovery). */
export function consumeHiddenRendererPtyDropMemory(id: string, hiddenDropEpisode?: number): void {
  const latch = droppedSinceHiddenPtys.get(id)
  if (latch?.state === 'awaiting-paint' && latch.episode === hiddenDropEpisode) {
    droppedSinceHiddenPtys.delete(id)
  }
}

export function isHiddenRendererPty(id: string): boolean {
  return isHiddenRendererPtyInAnyWindow(id)
}

/** Marks a PTY hidden on behalf of the runtime (no renderer view exists). */
export function markRuntimeOwnedHiddenRendererPty(id: string): void {
  recordHiddenRendererPtyWindowClaim(IMPLICIT_RENDERER_WINDOW_ID, id, true)
  runtimeOwnedHiddenRendererPtys.add(id)
}

export function isRuntimeOwnedHiddenRendererPty(id: string): boolean {
  return runtimeOwnedHiddenRendererPtys.has(id)
}

/** For freeze diagnostics only: hidden ptys must appear in the per-pty report
 *  table even when the gate dropped every byte before any send/accounting. */
export function getHiddenRendererPtyIds(): string[] {
  return getHiddenRendererPtyIdsAcrossWindows()
}

/** Renderer-side ref-counted interest, surfaced as boolean transitions. Scoped per window
 *  for the same reason the hidden bit is: a sibling's reload must not release this hold. */
export function setRendererPtyDeliveryInterest(
  id: string,
  interested: boolean,
  windowId = IMPLICIT_RENDERER_WINDOW_ID
): void {
  recordRendererPtyDeliveryInterestWindowClaim(windowId, id, interested)
}

export function shouldDropHiddenRendererPtyData(
  id: string,
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    isHiddenPtyDeliveryGateEnabled(settings) &&
    // Why the cross-window predicate: one window with the pane in the foreground vetoes the drop.
    isHiddenForEveryClaimingWindow(id) &&
    !hasRendererPtyDeliveryInterest(id)
  )
}

/** Record one gated drop. Returns whether the caller should emit the one-shot
 *  empty restore-marker chunk (first drop since the latch was retired or last revealed). */
export function recordHiddenRendererPtyDataDrop(
  id: string,
  chars: number
): { shouldEmitRestoreMarker: boolean; hiddenDropEpisode: number } {
  droppedHiddenDeliveryChars += chars
  droppedHiddenDeliveryChunks += 1
  const latch = droppedSinceHiddenPtys.get(id)
  if (latch?.state === 'unrevealed') {
    return { shouldEmitRestoreMarker: false, hiddenDropEpisode: latch.episode }
  }
  const episode = nextHiddenDropEpisode++
  droppedSinceHiddenPtys.set(id, { state: 'unrevealed', episode })
  return { shouldEmitRestoreMarker: true, hiddenDropEpisode: episode }
}

/** Renderer process replaced (reload / crash): its ref-counted interest
 *  holds and hidden marks died with it, so keeping them would gate (or
 *  force-feed) PTYs no live renderer party asked about. Runtime-owned marks
 *  survive: no renderer party exists to re-mark them. Drop memory is
 *  preserved — surviving daemon/SSH PTYs may have dropped bytes the old
 *  renderer never restored; the new renderer's first hidden/visible sync
 *  re-marks or unmarks and the unmark path re-emits the restore marker. */
export function resetRendererScopedHiddenPtyDeliveryState(windowId?: number): void {
  if (windowId === undefined) {
    resetAllRendererPtyWindowClaims()
  } else {
    clearRendererPtyWindowClaims(windowId)
  }
  for (const id of runtimeOwnedHiddenRendererPtys) {
    recordHiddenRendererPtyWindowClaim(IMPLICIT_RENDERER_WINDOW_ID, id, true)
  }
}

/** Full per-PTY teardown — wired into clearProviderPtyState so every exit
 *  path (local, daemon, SSH, connection teardown) releases gate state. */
export function clearHiddenRendererPtyDeliveryState(id: string): { activeChanged: boolean } {
  const cleared = clearRendererPtyWindowClaimsForPty(id)
  runtimeOwnedHiddenRendererPtys.delete(id)
  droppedSinceHiddenPtys.delete(id)
  return { activeChanged: cleared.activeChanged }
}

export type HiddenRendererPtyDeliveryDebug = {
  hiddenDeliveryGatedPtyCount: number
  deliveryInterestPtyCount: number
  hiddenDeliveryDroppedChars: number
  hiddenDeliveryDroppedChunks: number
}

export function getHiddenRendererPtyDeliveryDebug(): HiddenRendererPtyDeliveryDebug {
  return {
    hiddenDeliveryGatedPtyCount: getHiddenRendererPtyIdsAcrossWindows().length,
    deliveryInterestPtyCount: countRendererPtyDeliveryInterest(),
    hiddenDeliveryDroppedChars: droppedHiddenDeliveryChars,
    hiddenDeliveryDroppedChunks: droppedHiddenDeliveryChunks
  }
}

export function resetHiddenRendererPtyDeliveryDebugCounters(): void {
  droppedHiddenDeliveryChars = 0
  droppedHiddenDeliveryChunks = 0
}

/** Test seam: reset all module state between tests. */
export function _resetHiddenRendererPtyDeliveryGateForTest(): void {
  resetAllRendererPtyWindowClaims()
  runtimeOwnedHiddenRendererPtys.clear()
  droppedSinceHiddenPtys.clear()
  resetHiddenRendererPtyDeliveryDebugCounters()
}
