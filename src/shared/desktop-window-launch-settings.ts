import type { AgentLaunchVariant } from './agent-launch-variants'
import type { SetupRunPolicy } from './orca-yaml-hook-types'
export type DesktopWindowAndLaunchSettings = {
  defaultSetupRunPolicy: SetupRunPolicy
  agentLaunchVariants?: AgentLaunchVariant[]
  confirmCloseWindowWithRunningProcess: boolean
  experimentalMultiWindow: boolean
}

