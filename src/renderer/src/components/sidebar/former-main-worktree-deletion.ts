import type { Project } from '../../../../shared/project-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { resolveProjectPrimaryWorkspace } from '../../../../shared/project-primary-workspace'

/** Advisory only: the execution host validates Git topology before changing files. */
export function canDeleteFormerMainWorktree(
  worktree: Worktree,
  projects: readonly Project[],
  catalog: readonly Worktree[]
): boolean {
  if (!worktree.isMainWorktree || worktree.hostId !== 'local' || worktree.isBare) {
    return false
  }
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    return false
  }
  const project = projects.find((entry) => entry.id === worktree.projectId)
  const primary = project ? resolveProjectPrimaryWorkspace(project, catalog) : undefined
  return Boolean(
    primary &&
    primary.repoId === worktree.repoId &&
    primary.hostId === 'local' &&
    primary.instanceId !== worktree.instanceId &&
    !primary.isMainWorktree
  )
}
