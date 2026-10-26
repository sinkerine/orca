import type { AgentHookServer } from './server'
import type { RuntimeTerminalAgentStatusEvent } from '../runtime/runtime-terminal-contracts'
import { resolveClaudeLiveSessionIdUnderProcess } from '../claude/claude-live-process-session'
import { getLocalPtyProvider } from '../ipc/pty/provider/registry'
import { isRemoteExecutionHostPtyId } from '../../shared/remote-execution-host-pty-id'

/** Recover hookless Claude identities on the execution host while the process still exists. */
export function createTerminalStatusSessionRecovery(
  server: AgentHookServer,
  resolveSession: (ptyId: string) => Promise<string | null> = async (ptyId) => {
    const processes = await getLocalPtyProvider().listProcesses()
    const rootPid = processes.find((process) => process.id === ptyId)?.rootProcessId
    return rootPid ? resolveClaudeLiveSessionIdUnderProcess(rootPid) : null
  }
): (event: RuntimeTerminalAgentStatusEvent) => void {
  const pending = new Set<string>()
  return (event) => {
    server.ingestTerminalStatus(event)
    if (
      event.connectionId ||
      isRemoteExecutionHostPtyId(event.ptyId) ||
      event.payload.agentType !== 'claude' ||
      pending.has(event.paneKey)
    ) {
      return
    }
    const row = server.getStatusSnapshotForPane(event.paneKey)[0]
    if (!row || row.providerSession) {
      return
    }
    pending.add(event.paneKey)
    void resolveSession(event.ptyId)
      .then((id) => {
        const current = server.getStatusSnapshotForPane(event.paneKey)[0]
        if (
          !id ||
          !current ||
          current.providerSession ||
          current.receivedAt !== row.receivedAt ||
          current.agentType !== 'claude'
        ) {
          return
        }
        server.ingestTerminalStatus({ ...event, providerSession: { key: 'session_id', id } })
      })
      .catch(() => {})
      .finally(() => pending.delete(event.paneKey))
  }
}
