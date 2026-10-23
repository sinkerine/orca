import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value }
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
import type { RpcClient } from '../transport/rpc-client'
import { NewProjectDrawer } from './NewProjectDrawer'
import { newProjectDefaultParent, projectNameError } from './new-project-operations'

function reply(result: unknown) {
  return { id: 'test', ok: true as const, result }
}
async function render(sendRequest: RpcClient['sendRequest']) {
  const onCreated = vi.fn(),
    onClose = vi.fn()
  const client = { sendRequest }
  const props = {
    client,
    connected: true,
    hostName: 'Test host',
    onCreated,
    onClose
  }
  let tree: ReactTestRenderer | undefined
  await act(async () => {
    tree = create(createElement(NewProjectDrawer, props))
  })
  if (!tree) {
    throw new Error('Missing tree')
  }
  return { tree, props, onCreated, onClose }
}
function input(tree: ReactTestRenderer, label: string) {
  return tree.root.findByProps({ accessibilityLabel: label })
}
async function fill(tree: ReactTestRenderer) {
  await act(async () => {
    input(tree, 'Project name').props.onChangeText(' demo ')
  })
}

describe('new project', () => {
  it('validates names and uses the host home with Windows paths', () => {
    expect(projectNameError(' ')).toBeTruthy()
    expect(projectNameError('../demo')).toBeTruthy()
    expect(projectNameError('foo\\bar')).toBeTruthy()
    expect(projectNameError(' demo ')).toBeNull()
    expect(newProjectDefaultParent.interpret(reply({ resolvedPath: 'C:\\Users\\dev' }))).toBe(
      'C:\\Users\\dev\\orca\\projects'
    )
  })
  it('creates on the connected host and refreshes only after a successful reply', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(reply({ resolvedPath: '/home/test' }))
      .mockResolvedValueOnce(reply({ repo: { id: 'new' } }))
    const { tree, onCreated, onClose } = await render(send)
    expect(input(tree, 'Create project').props.disabled).toBe(true)
    await fill(tree)
    await act(async () => {
      input(tree, 'Create project').props.onPress()
    })
    expect(send.mock.calls[1]).toEqual([
      'repo.create',
      { name: 'demo', parentPath: '/home/test/orca/projects', kind: 'git' }
    ])
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('allows closing during creation and refreshes a confirmed late success', async () => {
    let resolve: (value: ReturnType<typeof reply>) => void = () => {}
    const send = vi
      .fn()
      .mockResolvedValueOnce(reply({ resolvedPath: '/home/test' }))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    const { tree, onCreated, onClose } = await render(send)
    await fill(tree)
    await act(async () => {
      input(tree, 'Create project').props.onPress()
    })
    act(() => {
      tree.root.find((node) => String(node.type) === 'BottomDrawer').props.onClose()
    })
    expect(onClose).toHaveBeenCalledOnce()
    act(() => tree.unmount())
    await act(async () => {
      resolve(reply({ repo: { id: 'late' } }))
    })
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('keeps a typed location when the default arrives late and disables disconnected creation', async () => {
    let resolve: (value: ReturnType<typeof reply>) => void = () => {}
    const send = vi.fn(
      () =>
        new Promise<ReturnType<typeof reply>>((done) => {
          resolve = done
        })
    )
    const { tree, props } = await render(send)
    act(() => {
      input(tree, 'Parent folder on host').props.onChangeText('/srv/projects')
    })
    await act(async () => {
      resolve(reply({ resolvedPath: '/home/test' }))
    })
    expect(input(tree, 'Parent folder on host').props.value).toBe('/srv/projects')
    await fill(tree)
    act(() => {
      tree.update(createElement(NewProjectDrawer, { ...props, connected: false }))
    })
    expect(input(tree, 'Create project').props.disabled).toBe(true)
  })
  it('keeps host errors visible and prevents repeated submissions while pending', async () => {
    let resolve: (value: ReturnType<typeof reply>) => void = () => {}
    const send = vi
      .fn()
      .mockResolvedValueOnce(reply({ resolvedPath: '/home/test' }))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    const { tree, onCreated, onClose } = await render(send)
    await fill(tree)
    await act(async () => {
      const press = input(tree, 'Create project').props.onPress
      press()
      press()
    })
    expect(send).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolve(reply({ error: 'Directory is not empty' }))
    })
    expect(tree.root.findByProps({ accessibilityRole: 'alert' }).props.children).toBe(
      'Directory is not empty'
    )
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
