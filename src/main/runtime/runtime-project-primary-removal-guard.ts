import type { Project } from '../../shared/project-types'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { parseExecutionHostId } from '../../shared/execution-host'

type Dependencies = {
  getStore: () => RuntimeStore | null
  isDesktopAuthority: () => boolean
  listResolvedWorktrees: () => Promise<ResolvedWorktree[]>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  getOwnPeerFingerprint: () => string | null
  assertAuthorityAvailable: () => void
}

export class RuntimeProjectPrimaryRemovalGuard {
  constructor(private readonly deps: Dependencies) {}

  async assertCatalogRemovalAllowed(
    projectId: string,
    repoId: string,
    hostId?: string
  ): Promise<void> {
    const keepsSetup = this.requireStore()
      .getProjectHostSetups?.()
      .some(
        (entry) =>
          entry.projectId === projectId &&
          (entry.repoId !== repoId || (hostId !== undefined && entry.hostId !== hostId))
      )
    // Forgetting the whole project keeps its checkouts on disk and leaves no primary to protect.
    if (keepsSetup) {
      await this.assertProjectRemovalAllowed(projectId, repoId, hostId)
    }
  }

  async assertSetupRemovalAllowed(
    projectId: string,
    setupId: string,
    expectedHostId?: string
  ): Promise<void> {
    const setup = this.requireStore()
      .getProjectHostSetups?.()
      .find((entry) => entry.id === setupId && entry.projectId === projectId)
    if (!setup || (expectedHostId && setup.hostId !== expectedHostId)) {
      throw new Error('primary_workspace_wrong_project')
    }
    await this.assertProjectRemovalAllowed(projectId, setup.repoId, setup.hostId)
  }

  private async assertProjectRemovalAllowed(
    projectId: string,
    repoId: string,
    hostId?: string
  ): Promise<void> {
    const project = this.requireStore()
      .getProjects?.()
      .find((entry) => entry.id === projectId)
    if (!project) {
      throw new Error('primary_workspace_wrong_project')
    }
    const primary = project.primaryWorkspace
    if (!primary) {
      if (Object.hasOwn(project, 'primaryAuthorityFingerprint')) {
        this.deps.assertAuthorityAvailable()
      }
      return
    }
    const setup = this.requireStore()
      .getProjectHostSetups?.()
      .find(
        (entry) =>
          entry.projectId === projectId &&
          entry.repoId === repoId &&
          (!hostId || entry.hostId === hostId)
      )
    if (!setup || (hostId && setup.hostId !== hostId)) {
      return
    }
    const savedLocatorNamesRepo =
      typeof primary.worktreeId === 'string' && primary.worktreeId.startsWith(`${repoId}::`)
    const parsedSetupHost = parseExecutionHostId(setup.hostId)
    const expectedOwnerHostId =
      parsedSetupHost?.kind === 'runtime' ? setup.runtimeOwnerHostId : setup.hostId
    const expectedOwnerFingerprint =
      parsedSetupHost?.kind === 'runtime'
        ? setup.runtimeOwnerFingerprint
        : this.deps.getOwnPeerFingerprint()
    const savedOwnerMatches = Boolean(
      primary.hostId &&
      expectedOwnerHostId &&
      primary.hostId === expectedOwnerHostId &&
      primary.peerFingerprint &&
      expectedOwnerFingerprint &&
      primary.peerFingerprint === expectedOwnerFingerprint
    )
    const savedOwnerContradicts = Boolean(
      (primary.hostId && expectedOwnerHostId && primary.hostId !== expectedOwnerHostId) ||
      (primary.peerFingerprint &&
        expectedOwnerFingerprint &&
        primary.peerFingerprint !== expectedOwnerFingerprint)
    )
    if (savedLocatorNamesRepo && savedOwnerMatches) {
      throw new Error('primary_selected')
    }
    if (savedLocatorNamesRepo && !savedOwnerMatches && !savedOwnerContradicts) {
      if (!this.deps.isDesktopAuthority()) {
        this.deps.assertAuthorityAvailable()
      }
      throw new Error('primary_workspace_identity_unavailable')
    }
    if (!primary.peerFingerprint || !primary.hostId || !primary.worktreeId || !primary.instanceId) {
      if (!this.deps.isDesktopAuthority()) {
        this.deps.assertAuthorityAvailable()
      }
      if (savedLocatorNamesRepo && !savedOwnerContradicts) {
        throw new Error('primary_selected')
      }
      throw new Error('primary_workspace_identity_unavailable')
    }
    const owner = await this.findPrimaryOwnerOnHost(projectId, primary, setup.hostId)
    if (!owner) {
      if (savedLocatorNamesRepo && !savedOwnerContradicts) {
        throw new Error('primary_workspace_unavailable')
      }
      return
    }
    const ownerHostId = owner.ownerHostId ?? owner.hostId
    const fingerprint =
      owner.peerFingerprint ??
      (ownerHostId === 'local' || ownerHostId?.startsWith('ssh:')
        ? this.deps.getOwnPeerFingerprint()
        : null)
    if (
      owner.repoId === repoId &&
      ownerHostId === primary.hostId &&
      fingerprint === primary.peerFingerprint
    ) {
      throw new Error('primary_selected')
    }
  }

  private async findPrimaryOwnerOnHost(
    projectId: string,
    primary: NonNullable<Project['primaryWorkspace']>,
    setupHostId: string
  ): Promise<ResolvedWorktree | undefined> {
    const parsedHost = parseExecutionHostId(setupHostId)
    const rows =
      parsedHost?.kind === 'runtime'
        ? await this.requireAuthenticatedRuntimeWorktrees(projectId, parsedHost.environmentId)
        : await this.deps.listResolvedWorktrees()
    return rows.find((entry) => {
      const ownerHostId = entry.ownerHostId ?? entry.hostId
      const peerFingerprint =
        entry.peerFingerprint ??
        (ownerHostId === 'local' || ownerHostId?.startsWith('ssh:')
          ? this.deps.getOwnPeerFingerprint()
          : null)
      return (
        entry.id === primary.worktreeId &&
        entry.instanceId === primary.instanceId &&
        ownerHostId === primary.hostId &&
        peerFingerprint === primary.peerFingerprint
      )
    })
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

  private requireStore(): RuntimeStore {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    return store
  }
}
