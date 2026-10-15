// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithPreservedBranchCleanup } from './orca-runtime-preserved-branch-cleanup'
import { RuntimeProjectPrimaryRemovalController } from './runtime-project-primary-removal-controller'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { parseExecutionHostId } from '../../shared/execution-host'
import { verifyPrimaryOwner } from './project-primary-owner-verification'
import { getProjectPrimaryAuthorityRegistry } from './project-primary-authority-registry'

export class OrcaRuntimeWithProjectPrimaryRemoval extends OrcaRuntimeWithPreservedBranchCleanup {
  protected readonly primaryRemoval = new RuntimeProjectPrimaryRemovalController({
    getStore: () => this.store,
    isDesktopAuthority: () => this.isDesktopPrimaryAuthorityFn(),
    listResolvedWorktrees: () => this.listResolvedWorktrees(),
    listAuthenticatedRuntimeWorktrees: (projectId, environmentId) =>
      this.listAuthenticatedRuntimeWorktreesFn(projectId, environmentId),
    verifyAuthoritativeWorktree: (worktree) => this.verifyProjectPrimaryOwner(worktree),
    getOwnPeerFingerprint: () => this.getOwnPeerFingerprintFn(),
    forwardRemovalBegin: (projectId, target) =>
      this.forwardProjectPrimaryRemovalBegin(projectId, target),
    forwardRemovalFinish: (projectId, token, target) =>
      this.forwardProjectPrimaryRemovalFinish(projectId, token, target),
    forwardSetupRemovalAuthorization: (projectId, setupId, operation) =>
      getProjectPrimaryAuthorityRegistry(this).authorizeSetupRemoval(projectId, setupId, operation),
    forwardProjectRemovalAuthorization: (projectId, repoId, operation) =>
      getProjectPrimaryAuthorityRegistry(this).authorizeProjectRemoval(projectId, repoId, operation)
  })

  beginPrimaryRemoval(projectId: string, target: PrimaryWorkspaceTarget): Promise<string> {
    return this.primaryRemoval.beginRemoval(projectId, target)
  }

  beginPrimaryRemovalForPeer(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    environmentId: string
  ): Promise<string> {
    return this.primaryRemoval.beginRemoval(projectId, target, environmentId)
  }

  isDesktopPrimaryAuthority(): boolean {
    return this.isDesktopPrimaryAuthorityFn()
  }

  forwardProjectPrimaryRemovalBegin(
    projectId: string,
    target: PrimaryWorkspaceTarget
  ): Promise<string> {
    return getProjectPrimaryAuthorityRegistry(this).beginRemoval(projectId, target)
  }

  forwardProjectPrimaryRemovalFinish(
    projectId: string,
    token: string,
    target: PrimaryWorkspaceTarget
  ): Promise<void> {
    return getProjectPrimaryAuthorityRegistry(this).finishRemoval(projectId, token, target)
  }

  async beginPrimaryRemovalForWorktree(
    worktreeId: string,
    hostId?: string
  ): Promise<{ token: string; target: PrimaryWorkspaceTarget; projectId: string } | null> {
    return this.primaryRemoval.beginRemovalForWorktree(worktreeId, hostId)
  }

  finishPrimaryRemoval(token: string, owner: PrimaryWorkspaceTarget): Promise<boolean> {
    return this.primaryRemoval.finishRemoval(token, owner)
  }

  recordPrimaryRemovalCompletion(token: string, owner: PrimaryWorkspaceTarget): Promise<void> {
    return this.primaryRemoval.recordCompletion(token, owner)
  }

  guardPrimarySetupRemoval(setupId: string, expectedHostId: string): Promise<void> {
    return this.primaryRemoval.guardPrimarySetupRemoval(setupId, expectedHostId)
  }

  guardPrimaryProjectRemoval<T>(
    repoId: string,
    expectedHostId: string | undefined,
    operation?: () => Promise<T>
  ): Promise<T> {
    return this.primaryRemoval.guardPrimaryProjectRemoval(repoId, expectedHostId, operation)
  }

  beginProjectRemovalPermit(
    projectId: string,
    resourceKey: string,
    environmentId: string,
    requesterFingerprint: string
  ): Promise<string> {
    return this.primaryRemoval.beginProjectRemovalPermit(
      projectId,
      resourceKey,
      environmentId,
      requesterFingerprint
    )
  }

  finishProjectRemovalPermit(
    token: string,
    projectId: string,
    resourceKey: string,
    requesterFingerprint: string,
    isCurrent: () => boolean
  ): Promise<boolean> {
    return this.primaryRemoval.finishProjectRemovalPermit(
      token,
      projectId,
      resourceKey,
      requesterFingerprint,
      isCurrent
    )
  }

  protected verifyProjectPrimaryOwner(worktree: ResolvedWorktree): Promise<boolean> {
    if (parseExecutionHostId(worktree.hostId)?.kind === 'runtime') {
      return Promise.resolve(
        Boolean(
          worktree.peerFingerprint &&
          worktree.instanceId &&
          this.requireStore()
            .getProjectHostSetups?.()
            .some(
              (setup) =>
                setup.repoId === worktree.repoId &&
                setup.hostId === worktree.hostId &&
                setup.setupState === 'ready'
            )
        )
      )
    }
    return verifyPrimaryOwner(worktree, {
      listRepos: () => this.listRepos(),
      store: this.requireStore()
    })
  }
}
