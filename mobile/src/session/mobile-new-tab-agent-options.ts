import type { TuiAgent } from '../../../src/shared/tui-agent'
import { normalizeAgentLaunchVariants } from '../../../src/shared/agent-launch-variants'
import {
  filterEnabledMobileTuiAgents,
  isMobileTuiAgent,
  MOBILE_TUI_AGENT_AUTO_PICK_ORDER,
  MOBILE_TUI_AGENT_LABELS
} from '../tasks/mobile-tui-agents'

export type MobileNewTabAgentSettings = {
  defaultTuiAgent?: TuiAgent | 'blank' | null
  disabledTuiAgents?: unknown
  agentLaunchVariants?: unknown
}

export type MobileNewTabAgentOption = {
  agent: TuiAgent
  label: string
  variantId?: string
  command?: string
}

export function orderMobileNewTabAgents(
  defaultAgent: TuiAgent | 'blank' | null | undefined,
  detectedAgents: Iterable<unknown>,
  disabledAgents?: unknown
): TuiAgent[] {
  const detected = new Set([...detectedAgents].filter(isMobileTuiAgent))
  const enabledDetected = filterEnabledMobileTuiAgents(
    MOBILE_TUI_AGENT_AUTO_PICK_ORDER,
    disabledAgents
  ).filter((agent) => detected.has(agent))

  if (defaultAgent && defaultAgent !== 'blank' && enabledDetected.includes(defaultAgent)) {
    return [defaultAgent, ...enabledDetected.filter((agent) => agent !== defaultAgent)]
  }
  return enabledDetected
}

export function buildMobileNewTabAgentOptions(
  settings: MobileNewTabAgentSettings | null | undefined,
  detectedAgentIds: Iterable<unknown> | null
): MobileNewTabAgentOption[] {
  if (!detectedAgentIds) {
    return []
  }
  const agents = orderMobileNewTabAgents(
    settings?.defaultTuiAgent,
    detectedAgentIds,
    settings?.disabledTuiAgents
  )
  return [
    ...agents.map((agent) => ({ agent, label: MOBILE_TUI_AGENT_LABELS[agent] })),
    ...normalizeAgentLaunchVariants(settings?.agentLaunchVariants)
      .filter((variant) => agents.includes(variant.agent))
      .map((variant) => ({
        agent: variant.agent,
        label: `${MOBILE_TUI_AGENT_LABELS[variant.agent]}: ${variant.name}`,
        variantId: variant.id,
        command: variant.command
      }))
  ]
}
