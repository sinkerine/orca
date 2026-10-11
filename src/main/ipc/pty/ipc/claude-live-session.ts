import { getPtyIpc } from '../../pty-host-bindings'
import { parseAppSshPtyId } from '../../../providers/ssh-pty-id'
import { resolveClaudeLiveSessionIdUnderProcess } from '../../../claude/claude-live-process-session'
import { ptyOwnership } from '../provider/ownership-state'
import { getLocalPtyProvider } from '../provider/registry'

export function installPtyClaudeLiveSessionIpcHandler(deps: {
  getLocalPtyProviderStartupPromise: (connectionId?: string | null) => Promise<void> | undefined
}): void {
  getPtyIpc().handle(
    'pty:resolveClaudeSessionId',
    async (_event, args: { id?: unknown }): Promise<string | null> => {
      const id = args?.id
      // Why: Claude's session files and the process table read here are this machine's only.
      if (
        typeof id !== 'string' ||
        !id ||
        id.startsWith('remote:') ||
        parseAppSshPtyId(id) ||
        ptyOwnership.get(id)
      ) {
        return null
      }
      try {
        await deps.getLocalPtyProviderStartupPromise()
        const processes = await getLocalPtyProvider().listProcesses()
        const rootPid = processes.find((process) => process.id === id)?.rootProcessId
        return rootPid ? await resolveClaudeLiveSessionIdUnderProcess(rootPid) : null
      } catch {
        return null
      }
    }
  )
}
