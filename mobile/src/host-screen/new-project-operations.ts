import { z } from 'zod'
import { getDefaultCreateProjectParent } from '../../../src/shared/create-project-defaults'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

export { joinCreateProjectPath } from '../../../src/shared/create-project-defaults'

export const newProjectDefaultParent = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.new-project-default-parent',
    method: 'files.browseServerDir',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'default-parent',
      z
        .object({ resolvedPath: z.string().min(1) })
        .transform(({ resolvedPath }) => getDefaultCreateProjectParent(resolvedPath))
    )
  })
)

export const newProjectCreate = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'repo.create-new-project',
    method: 'repo.create',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'created-project',
      z.union([
        z.object({ error: z.string() }),
        z.object({ repo: z.object({ id: z.string().min(1) }) })
      ])
    )
  })
)

export function projectNameError(name: string): string | null {
  const value = name.trim()
  if (!value) {
    return 'Enter a project name.'
  }
  if (/[\\/]/.test(value) || value === '.' || value === '..') {
    return 'Use a name without slashes or parent-directory references.'
  }
  return null
}
