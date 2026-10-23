import { describe, expect, it } from 'vitest'

import {
  buildMobileNewTabAgentOptions,
  orderMobileNewTabAgents
} from './mobile-new-tab-agent-options'

describe('mobile new-tab agent options', () => {
  it('orders the enabled detected default first', () => {
    expect(orderMobileNewTabAgents('codex', ['gemini', 'codex', 'claude'], ['gemini'])).toEqual([
      'codex',
      'claude'
    ])
  })

  it('returns labeled options for enabled detected agents only', () => {
    expect(
      buildMobileNewTabAgentOptions({ defaultTuiAgent: null, disabledTuiAgents: ['claude'] }, [
        'claude',
        'codex',
        'not-real'
      ])
    ).toEqual([{ agent: 'codex', label: 'Codex' }])
  })

  it('adds normalized variants only for enabled agents detected on the execution host', () => {
    expect(
      buildMobileNewTabAgentOptions(
        {
          defaultTuiAgent: 'codex',
          disabledTuiAgents: ['claude'],
          agentLaunchVariants: [
            { id: 'fast', name: ' Fast ', agent: 'codex', command: ' codex --fast ' },
            { id: 'fast', name: 'Duplicate', agent: 'codex', command: 'codex' },
            { id: 'disabled', name: 'Disabled', agent: 'claude', command: 'claude' },
            { id: 'missing', name: 'Missing', agent: 'gemini', command: 'gemini' },
            { id: 'invalid', name: 'Invalid', agent: 'codex', command: ' ' }
          ]
        },
        ['claude', 'codex']
      )
    ).toEqual([
      { agent: 'codex', label: 'Codex' },
      { agent: 'codex', label: 'Codex: Fast', variantId: 'fast', command: 'codex --fast' }
    ])
  })

  it('does not show stale presets while detection is pending', () => {
    expect(buildMobileNewTabAgentOptions({ defaultTuiAgent: 'codex' }, null)).toEqual([])
  })
})
