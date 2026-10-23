import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useTerminalModelPicker } from './use-terminal-model-picker'
import { runRpcOperation } from '../transport/rpc-operation'

vi.mock('../transport/rpc-operation', () => ({
  defineRpcOperation: (value: unknown) => value,
  runRpcOperation: vi.fn()
}))
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked RPC operation never reads the client.
const client = {} as RpcClient
let renderer: ReactTestRenderer | undefined
let api: ReturnType<typeof useTerminalModelPicker>
function Harness({ terminal = 'term' }: { terminal?: string }) {
  api = useTerminalModelPicker(client, terminal)
  return null
}
afterEach(() => {
  act(() => renderer?.unmount())
  vi.resetAllMocks()
})
const model = {
  terminal: 'term',
  phase: 'model',
  transactionId: 'tx',
  descriptor: {
    id: 'model',
    label: 'Model',
    kind: { type: 'select', choices: [{ value: 'opaque', label: 'Actual model' }] }
  }
}

describe('terminal model drawer controller', () => {
  it('dismisses after the host expires or forgets the transaction', async () => {
    vi.mocked(runRpcOperation)
      .mockResolvedValueOnce(model)
      .mockResolvedValueOnce({ terminal: 'term', phase: 'unavailable' })
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => api.open())
    await act(async () => api.close())
    expect(api.visible).toBe(false)
  })

  it('recovers a lost open reply without replaying a selection', async () => {
    vi.mocked(runRpcOperation)
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({ terminal: 'term', phase: 'uncertain', transactionId: 'recovered' })
      .mockResolvedValueOnce({ terminal: 'term', phase: 'cancelled' })
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => api.open())
    expect(api.result?.phase).toBe('uncertain')
    await act(async () => api.release())
    expect(api.result?.transactionId).toBe('recovered')
    await act(async () => api.release())
    expect(runRpcOperation).toHaveBeenLastCalledWith(
      client,
      expect.anything(),
      { terminal: 'term', action: 'release', transactionId: 'recovered' },
      expect.anything()
    )
    expect(api.visible).toBe(false)
  })

  it('uses opaque choices and keeps the effort step open until confirmed', async () => {
    vi.mocked(runRpcOperation)
      .mockResolvedValueOnce(model)
      .mockResolvedValueOnce({ ...model, phase: 'effort' })
      .mockResolvedValueOnce({ terminal: 'term', phase: 'applied' })
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => api.open())
    expect(api.result?.phase).toBe('model')
    await act(async () => api.select('opaque'))
    expect(runRpcOperation).toHaveBeenLastCalledWith(
      client,
      expect.anything(),
      { terminal: 'term', action: 'select', transactionId: 'tx', optionId: 'opaque' },
      expect.anything()
    )
    expect(api.visible).toBe(true)
    await act(async () => api.select('effort-choice'))
    expect(api.visible).toBe(false)
  })

  it('does not retry an ambiguous write and offers explicit release', async () => {
    vi.mocked(runRpcOperation)
      .mockResolvedValueOnce(model)
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValueOnce({ terminal: 'term', phase: 'cancelled' })
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => api.open())
    await act(async () => api.select('opaque'))
    expect(api.result?.phase).toBe('uncertain')
    expect(runRpcOperation).toHaveBeenCalledTimes(2)
    await act(async () => api.release())
    expect(api.visible).toBe(false)
  })

  it('cancels the old terminal transaction when switching tabs', async () => {
    vi.mocked(runRpcOperation).mockResolvedValue(model)
    act(() => {
      renderer = create(createElement(Harness))
    })
    await act(async () => api.open())
    await act(async () => renderer?.update(createElement(Harness, { terminal: 'other' })))
    expect(runRpcOperation).toHaveBeenLastCalledWith(
      client,
      expect.anything(),
      { terminal: 'term', action: 'cancel', transactionId: 'tx' },
      expect.anything()
    )
    expect(api.result).toBeNull()
  })
})
