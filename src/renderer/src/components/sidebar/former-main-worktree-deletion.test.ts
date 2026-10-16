import { describe, expect, it } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { canDeleteFormerMainWorktree } from './former-main-worktree-deletion'

const original = {
  id: 'r::/old',
  repoId: 'r',
  projectId: 'p',
  path: '/old',
  hostId: 'local',
  instanceId: 'old',
  isMainWorktree: true
} as Worktree
const selected = {
  ...original,
  id: 'r::/new',
  path: '/new',
  instanceId: 'new',
  isMainWorktree: false,
  peerFingerprint: 'peer'
}
const project = {
  id: 'p',
  primaryWorkspaceRevision: 1,
  primaryAuthorityFingerprint: 'peer',
  primaryWorkspace: {
    worktreeId: selected.id,
    instanceId: 'new',
    hostId: 'local',
    path: '/new',
    peerFingerprint: 'peer',
    authorityFingerprint: 'peer'
  }
} as Project

describe('former main checkout deletion policy', () => {
  it('offers deletion only after resolving a different primary in the same local repository', () => {
    expect(canDeleteFormerMainWorktree(original, [project], [original, selected])).toBe(true)
    expect(canDeleteFormerMainWorktree(original, [], [original, selected])).toBe(false)
    expect(canDeleteFormerMainWorktree(original, [project], [original])).toBe(false)
    expect(
      canDeleteFormerMainWorktree(original, [project], [{ ...selected, instanceId: 'replacement' }])
    ).toBe(false)
    expect(
      canDeleteFormerMainWorktree(original, [project], [{ ...selected, repoId: 'other' }])
    ).toBe(false)
    expect(
      canDeleteFormerMainWorktree({ ...original, hostId: 'ssh:host' }, [project], [selected])
    ).toBe(false)
  })
})
