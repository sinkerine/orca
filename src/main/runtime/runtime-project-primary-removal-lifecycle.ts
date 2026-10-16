import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import type { ProjectPrimaryMutationGate } from './project-primary-mutation-gate'
import { parseExecutionHostId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'

type Dependencies = {
  getStore: () => RuntimeStore | null
  isDesktopAuthority: () => boolean
  listResolvedWorktrees: () => Promise<ResolvedWorktree[]>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  verifyAuthoritativeWorktree?: (worktree: ResolvedWorktree) => Promise<boolean>
  getOwnPeerFingerprint: () => string | null
  forwardRemovalBegin?: (projectId: string, target: PrimaryWorkspaceTarget) => Promise<string>
  forwardRemovalFinish?: (
    projectId: string,
    token: string,
    target: PrimaryWorkspaceTarget
  ) => Promise<void>
  getGate: () => ProjectPrimaryMutationGate
}

function sameTarget(left: PrimaryWorkspaceTarget, right: PrimaryWorkspaceTarget): boolean {
  return (
    left.peerFingerprint === right.peerFingerprint &&
    left.hostId === right.hostId &&
    left.instanceId === right.instanceId
  )
}

export class RuntimeProjectPrimaryRemovalLifecycle {
  private readonly completedTokens = new Map<string, PrimaryWorkspaceTarget>()
  private readonly forwardedProjectByToken = new Map<string, string>()
  private readonly forwardedTargetByToken = new Map<string, PrimaryWorkspaceTarget>()

  constructor(private readonly deps: Dependencies) {}

  hasCompleted(token: string): boolean {
    return this.completedTokens.has(token)
  }

  async beginRemoval(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    ownerEnvironmentId?: string
  ): Promise<string> {
    if (!this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardRemovalBegin) {
        throw new Error('primary_authority_unavailable')
      }
      return this.deps.forwardRemovalBegin(projectId, target).then((token) => {
        this.forwardedProjectByToken.set(token, projectId)
        this.forwardedTargetByToken.set(token, { ...target })
        return token
      })
    }
    const worktrees = ownerEnvironmentId
      ? await this.requireAuthenticatedRuntimeWorktrees(projectId, ownerEnvironmentId)
      : await this.deps.listResolvedWorktrees()
    const row = worktrees.find(
      (entry) =>
        entry.instanceId === target.instanceId &&
        (target.path === undefined || entry.path === target.path) &&
        (entry.peerFingerprint ??
          ((entry.ownerHostId ?? entry.hostId) === 'local' ||
          (entry.ownerHostId ?? entry.hostId)?.startsWith('ssh:')
            ? this.deps.getOwnPeerFingerprint()
            : null)) === target.peerFingerprint &&
        (entry.ownerHostId ?? entry.hostId) === target.hostId
    )
    if (!row || !(await this.verifyRemovalOwner(row, ownerEnvironmentId))) {
      throw new Error('primary_workspace_unavailable')
    }
    const store = this.requireStore()
    const setup = store
      .getProjectHostSetups?.()
      .find(
        (entry) =>
          entry.projectId === projectId &&
          entry.repoId === row.repoId &&
          (!ownerEnvironmentId || entry.hostId === `runtime:${ownerEnvironmentId}`)
      )
    if (!setup) {
      throw new Error('primary_workspace_wrong_project')
    }
    const repo = store.getRepos().find((entry) => entry.id === row.repoId)
    if (repo && isFolderRepo(repo)) {
      throw new Error('primary_workspace_not_removable')
    }
    if (row.git.isMainWorktree) {
      const project = store.getProjects?.().find((entry) => entry.id === projectId)
      const primary = project?.primaryWorkspace
      if (!primary || sameTarget(primary as PrimaryWorkspaceTarget, target)) {
        throw new Error('primary_selected')
      }
      if (target.hostId !== 'local' || ownerEnvironmentId || process.platform === 'win32') {
        throw new Error(
          'Original-checkout deletion requires a native macOS or Linux repository; the repository was kept.'
        )
      }
      const selected = worktrees.find(
        (entry) =>
          entry.repoId === row.repoId &&
          entry.instanceId === primary.instanceId &&
          entry.path === primary.path &&
          (entry.ownerHostId ?? entry.hostId) === primary.hostId &&
          entry.peerFingerprint === primary.peerFingerprint
      )
      if (
        !selected ||
        selected.git.isMainWorktree ||
        selected.git.isBare ||
        selected.git.prunable ||
        !(await this.verifyRemovalOwner(selected))
      ) {
        throw new Error(
          'The selected primary must be an available linked checkout in the same repository.'
        )
      }
    }
    return this.deps.getGate().beginRemoval(projectId, target)
  }

  async beginRemovalForWorktree(
    worktreeId: string,
    hostId?: string
  ): Promise<{ token: string; target: PrimaryWorkspaceTarget; projectId: string } | null> {
    const store = this.requireStore()
    const repoId = worktreeId.slice(0, worktreeId.indexOf('::'))
    const setup = store
      .getProjectHostSetups?.()
      .find((entry) => entry.repoId === repoId && (!hostId || entry.hostId === hostId))
    const projectId = setup?.projectId
    if (!projectId) {
      return null
    }
    const project = store.getProjects?.().find((entry) => entry.id === projectId)
    if (!project) {
      return null
    }
    if (!project.primaryWorkspace && !Object.hasOwn(project, 'primaryAuthorityFingerprint')) {
      return null
    }
    const parsedHost = parseExecutionHostId(hostId)
    const environment = parsedHost?.kind === 'runtime' ? parsedHost.environmentId : undefined
    const worktrees = environment
      ? await this.requireAuthenticatedRuntimeWorktrees(projectId, environment)
      : await this.deps.listResolvedWorktrees()
    const row = worktrees.find(
      (entry) => entry.id === worktreeId && (!hostId || entry.hostId === hostId)
    )
    if (!row) {
      throw new Error('primary_workspace_unavailable')
    }
    const peerFingerprint =
      row.peerFingerprint ??
      (row.hostId === 'local' || row.hostId?.startsWith('ssh:')
        ? this.deps.getOwnPeerFingerprint()
        : null)
    const ownerHostId = row.ownerHostId ?? row.hostId
    const parsedOwnerHostId = parseExecutionHostId(ownerHostId)
    if (
      !ownerHostId ||
      !parsedOwnerHostId ||
      parsedOwnerHostId.kind === 'runtime' ||
      !row.instanceId ||
      !peerFingerprint
    ) {
      throw new Error('primary_workspace_identity_unavailable')
    }
    const target = {
      peerFingerprint,
      hostId: ownerHostId,
      instanceId: row.instanceId,
      path: row.path
    }
    const token = await this.beginRemoval(projectId, target, environment)
    return { token, target, projectId }
  }

  cancelRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    if (!this.deps.isDesktopAuthority()) {
      return Promise.resolve()
    }
    return this.deps.getGate().cancelRemoval(token, owner)
  }

  finishRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<boolean> {
    if (!this.deps.isDesktopAuthority()) {
      const completedTarget = this.completedTokens.get(token)
      const finished = Boolean(completedTarget && sameTarget(completedTarget, owner))
      this.completedTokens.delete(token)
      this.forwardedProjectByToken.delete(token)
      this.forwardedTargetByToken.delete(token)
      return Promise.resolve(finished)
    }
    return this.deps
      .getGate()
      .finishRemoval(token, owner)
      .then((finished) => {
        if (finished) {
          this.completedTokens.delete(token)
        }
        return finished
      })
  }

  async recordCompletion(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    if (!this.deps.isDesktopAuthority()) {
      const projectId = this.forwardedProjectByToken.get(token)
      const expectedTarget = this.forwardedTargetByToken.get(token)
      if (!projectId || !this.deps.forwardRemovalFinish) {
        throw new Error('unknown_removal_token')
      }
      if (!expectedTarget || !sameTarget(expectedTarget, owner)) {
        throw new Error('owner_mismatch')
      }
      await this.deps.forwardRemovalFinish(projectId, token, owner)
      this.completedTokens.set(token, { ...owner })
      return
    }
    await this.deps.getGate().assertRemovalOwner(token, owner)
    this.completedTokens.set(token, { ...owner })
  }

  private requireAuthenticatedRuntimeWorktrees(
    projectId: string,
    environmentId: string
  ): Promise<ResolvedWorktree[]> {
    if (!this.deps.listAuthenticatedRuntimeWorktrees) {
      throw new Error('primary_authority_unavailable')
    }
    return this.deps.listAuthenticatedRuntimeWorktrees(projectId, environmentId)
  }

  private async verifyRemovalOwner(
    worktree: ResolvedWorktree,
    ownerEnvironmentId?: string
  ): Promise<boolean> {
    if (ownerEnvironmentId) {
      return (
        worktree.hostId === `runtime:${ownerEnvironmentId}` &&
        worktree.runtimeOwnerEnvironmentId === ownerEnvironmentId &&
        Boolean(worktree.peerFingerprint)
      )
    }
    return this.deps.verifyAuthoritativeWorktree
      ? this.deps.verifyAuthoritativeWorktree(worktree)
      : false
  }

  private requireStore(): RuntimeStore {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    return store
  }
}
