import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { ProjectPrimaryMutationGate } from './project-primary-mutation-gate'
import { RuntimeProjectPrimaryRemovalGuard } from './runtime-project-primary-removal-guard'
import { RuntimeProjectPrimaryRemovalLifecycle } from './runtime-project-primary-removal-lifecycle'

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
  forwardSetupRemovalAuthorization?: <T>(
    projectId: string,
    setupId: string,
    operation: () => Promise<T>
  ) => Promise<T>
  forwardProjectRemovalAuthorization?: <T>(
    projectId: string,
    repoId: string,
    operation: () => Promise<T>
  ) => Promise<T>
}

export class RuntimeProjectPrimaryRemovalController {
  private gate: ProjectPrimaryMutationGate | null = null
  private removalGuard: RuntimeProjectPrimaryRemovalGuard | null = null
  private removalLifecycle: RuntimeProjectPrimaryRemovalLifecycle | null = null

  constructor(private readonly deps: Dependencies) {}

  runPrimaryMutation<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.getGate().withPrimaryChange(projectId, target, operation)
  }

  async guardSetupRemoval<T>(
    setupId: string,
    operation: () => Promise<T>,
    expectedHostId?: string
  ): Promise<T> {
    const store = this.requireStore()
    const setup = store.getProjectHostSetups?.().find((entry) => entry.id === setupId)
    if (!setup) {
      throw new Error(`Project host setup not found: ${setupId}`)
    }
    const project = store.getProjects?.().find((entry) => entry.id === setup.projectId)
    if (!project) {
      throw new Error(`Project not found: ${setup.projectId}`)
    }
    if (expectedHostId && setup.hostId !== expectedHostId) {
      throw new Error('primary_workspace_owner_mismatch')
    }
    const authorityBound = Object.hasOwn(project, 'primaryAuthorityFingerprint')
    if (authorityBound && !this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardSetupRemovalAuthorization) {
        throw new Error('primary_authority_unavailable')
      }
      return this.deps.forwardSetupRemovalAuthorization(project.id, setupId, operation)
    }
    return this.getGate().withProjectLock(project.id, async () => {
      await this.getRemovalGuard().assertSetupRemovalAllowed(project.id, setupId, expectedHostId)
      return operation()
    })
  }

  async guardProjectRemoval<T>(
    repoId: string,
    hostId: string | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const store = this.requireStore()
    const setups =
      store
        .getProjectHostSetups?.()
        .filter((entry) => entry.repoId === repoId && (!hostId || entry.hostId === hostId)) ?? []
    const projectIds = [...new Set(setups.map((entry) => entry.projectId))].sort()
    const boundProjectIds = projectIds.filter((projectId) => {
      const project = store.getProjects?.().find((entry) => entry.id === projectId)
      return project && Object.hasOwn(project, 'primaryAuthorityFingerprint')
    })
    if (boundProjectIds.length > 0 && !this.deps.isDesktopAuthority()) {
      if (!this.deps.forwardProjectRemovalAuthorization) {
        throw new Error('primary_authority_unavailable')
      }
      const runForwarded = async (index: number): Promise<T> => {
        const projectId = boundProjectIds[index]
        if (!projectId) {
          return operation()
        }
        return this.deps.forwardProjectRemovalAuthorization!(projectId, repoId, () =>
          runForwarded(index + 1)
        )
      }
      return runForwarded(0)
    }
    const run = async (index: number): Promise<T> => {
      const projectId = projectIds[index]
      if (!projectId) {
        return operation()
      }
      return this.getGate().withProjectLock(projectId, async () => {
        const project = store.getProjects?.().find((entry) => entry.id === projectId)
        if (project && Object.hasOwn(project, 'primaryAuthorityFingerprint')) {
          this.getGate().assertAuthorityAvailable()
        }
        await this.getRemovalGuard().assertCatalogRemovalAllowed(projectId, repoId, hostId)
        return run(index + 1)
      })
    }
    return run(0)
  }

  async beginProjectRemovalPermit(
    projectId: string,
    resourceKey: string,
    environmentId: string,
    requesterFingerprint: string
  ): Promise<string> {
    if (!this.deps.isDesktopAuthority()) {
      throw new Error('primary_authority_unavailable')
    }
    const setupPrefix = 'setup:'
    const repoPrefix = 'repo:'
    const hostId = `runtime:${environmentId}`
    const preflight = async (): Promise<void> => {
      if (resourceKey.startsWith(setupPrefix)) {
        await this.getRemovalGuard().assertSetupRemovalAllowed(
          projectId,
          resourceKey.slice(setupPrefix.length),
          hostId
        )
        return
      }
      if (resourceKey.startsWith(repoPrefix)) {
        const repoId = resourceKey.slice(repoPrefix.length)
        const belongs = this.requireStore()
          .getProjectHostSetups?.()
          .some(
            (entry) =>
              entry.projectId === projectId && entry.repoId === repoId && entry.hostId === hostId
          )
        if (!belongs) {
          throw new Error('primary_workspace_wrong_project')
        }
        await this.getRemovalGuard().assertCatalogRemovalAllowed(projectId, repoId, hostId)
        return
      }
      throw new Error('invalid_primary_project_mutation_resource')
    }
    return this.getGate().beginProjectMutationPermit(
      projectId,
      resourceKey,
      requesterFingerprint,
      preflight
    )
  }

  finishProjectRemovalPermit(
    token: string,
    projectId: string,
    resourceKey: string,
    requesterFingerprint: string,
    isCurrent: () => boolean
  ): Promise<boolean> {
    if (!this.deps.isDesktopAuthority()) {
      return Promise.resolve(false)
    }
    return this.getGate().finishProjectMutationPermit(
      token,
      { projectId, resourceKey, requesterFingerprint },
      isCurrent
    )
  }

  guardPrimarySetupRemoval(setupId: string, expectedHostId: string): Promise<void> {
    return this.guardSetupRemoval(setupId, async () => undefined, expectedHostId)
  }

  guardPrimaryProjectRemoval<T>(
    repoId: string,
    expectedHostId: string | undefined,
    operation: () => Promise<T> = async () => undefined as T
  ): Promise<T> {
    return this.guardProjectRemoval(repoId, expectedHostId, operation)
  }

  beginRemoval(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    ownerEnvironmentId?: string
  ): Promise<string> {
    return this.getRemovalLifecycle().beginRemoval(projectId, target, ownerEnvironmentId)
  }

  beginRemovalForWorktree(
    worktreeId: string,
    hostId?: string
  ): Promise<{ token: string; target: PrimaryWorkspaceTarget; projectId: string } | null> {
    return this.getRemovalLifecycle().beginRemovalForWorktree(worktreeId, hostId)
  }

  cancelRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    return this.getRemovalLifecycle().cancelRemoval(token, owner)
  }

  finishRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<boolean> {
    return this.getRemovalLifecycle().finishRemoval(token, owner)
  }

  recordCompletion(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    return this.getRemovalLifecycle().recordCompletion(token, owner)
  }

  private getGate(): ProjectPrimaryMutationGate {
    if (this.gate) {
      return this.gate
    }
    const store = this.requireStore()
    this.gate = new ProjectPrimaryMutationGate({
      store: {
        load: async () => {
          if (typeof store.getPrimaryRemovalReservations !== 'function') {
            throw new Error('runtime_unavailable')
          }
          return store.getPrimaryRemovalReservations()
        },
        save: async (reservation) => {
          if (!store.savePrimaryRemovalReservation) {
            throw new Error('runtime_unavailable')
          }
          await store.savePrimaryRemovalReservation(reservation)
        },
        remove: async (token) => {
          if (!store.removePrimaryRemovalReservation) {
            throw new Error('runtime_unavailable')
          }
          await store.removePrimaryRemovalReservation(token)
        }
      },
      isAuthorityAvailable: () =>
        this.deps.isDesktopAuthority() &&
        this.requireStore().isPrimaryWorkspaceMutationAvailable !== false,
      getPrimary: (projectId) => {
        const primary = store
          .getProjects?.()
          .find((entry) => entry.id === projectId)?.primaryWorkspace
        if (
          primary &&
          (!primary.peerFingerprint ||
            !primary.authorityFingerprint ||
            !primary.hostId ||
            !primary.worktreeId ||
            !primary.path ||
            !primary.instanceId)
        ) {
          throw new Error('primary_workspace_identity_unavailable')
        }
        return primary?.peerFingerprint
          ? {
              peerFingerprint: primary.peerFingerprint,
              hostId: primary.hostId,
              instanceId: primary.instanceId,
              path: primary.path
            }
          : undefined
      },
      confirmRemovalCompletion: async (reservation) =>
        this.getRemovalLifecycle().hasCompleted(reservation.token)
    })
    return this.gate
  }

  private getRemovalGuard(): RuntimeProjectPrimaryRemovalGuard {
    if (!this.removalGuard) {
      this.removalGuard = new RuntimeProjectPrimaryRemovalGuard({
        ...this.deps,
        assertAuthorityAvailable: () => this.getGate().assertAuthorityAvailable()
      })
    }
    return this.removalGuard
  }

  private getRemovalLifecycle(): RuntimeProjectPrimaryRemovalLifecycle {
    if (!this.removalLifecycle) {
      this.removalLifecycle = new RuntimeProjectPrimaryRemovalLifecycle({
        ...this.deps,
        getGate: () => this.getGate()
      })
    }
    return this.removalLifecycle
  }

  private requireStore(): RuntimeStore {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    return store
  }
}
