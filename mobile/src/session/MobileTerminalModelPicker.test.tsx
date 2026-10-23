import { createElement } from 'react'
import { Pressable } from 'react-native'
import { DescriptorRows } from './MobileNativeChatSessionOptionRows'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { MobileTerminalModelPicker } from './MobileTerminalModelPicker'
import { useTerminalModelPicker } from './use-terminal-model-picker'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (v: unknown) => v },
  Text: 'Text',
  View: 'View'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./MobileNativeChatSessionOptionRows', () => ({
  DescriptorRows: 'DescriptorRows',
  SessionOptionCaption: 'SessionOptionCaption'
}))
vi.mock('./use-terminal-model-picker', () => ({ useTerminalModelPicker: vi.fn() }))

describe('terminal native model picker', () => {
  it('renders host choices and passes opaque IDs to selection', () => {
    const select = vi.fn()
    vi.mocked(useTerminalModelPicker).mockReturnValue({
      result: {
        terminal: 'term',
        phase: 'model',
        transactionId: 'tx',
        descriptor: {
          id: 'model',
          label: 'Select model',
          kind: {
            type: 'select',
            choices: [{ value: 'opaque', label: 'Configured variant model' }]
          }
        }
      },
      pending: false,
      visible: true,
      open: vi.fn(),
      select,
      close: vi.fn(),
      release: vi.fn()
    })
    let tree: ReturnType<typeof create>
    act(() => {
      tree = create(
        createElement(MobileTerminalModelPicker, {
          client: null,
          terminal: 'term',
          disabled: false
        })
      )
    })
    const rows = tree!.root.findByType(DescriptorRows)
    expect(rows.props.descriptor.kind.choices[0].label).toBe('Configured variant model')
    act(() => rows.props.onSetOption('opaque'))
    expect(select).toHaveBeenCalledWith('opaque')
    act(() => tree!.unmount())
  })

  it('offers recovery when the opening reply was lost', () => {
    const release = vi.fn()
    vi.mocked(useTerminalModelPicker).mockReturnValue({
      result: { terminal: 'term', phase: 'uncertain' },
      pending: false,
      visible: true,
      open: vi.fn(),
      select: vi.fn(),
      close: vi.fn(),
      release
    })
    let tree: ReturnType<typeof create>
    act(() => {
      tree = create(
        createElement(MobileTerminalModelPicker, {
          client: null,
          terminal: 'term',
          disabled: false
        })
      )
    })
    const recovery = tree!.root
      .findAllByType(Pressable)
      .find((node) => node.props.onPress === release)
    expect(recovery).toBeDefined()
    act(() => recovery!.props.onPress())
    expect(release).toHaveBeenCalledOnce()
    act(() => tree!.unmount())
  })
})
