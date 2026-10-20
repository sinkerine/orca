import type {
  Project,
  ProjectHostSetup,
  ProjectHostSetupCloneArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  ProjectPrimarySelector,
  ProjectUpdateArgs
} from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import {
  getRepoExecutionHostId,
  getSshTargetIdForExecutionHost,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { getProjectHostSetupForRepo } from '../../shared/project-host-setup-lookup'
import { resolveImportedFolderProjectLink } from '../../shared/imported-folder-project-identity'
import { invalidateAuthorizedRootsCache } from '../ipc/registered-worktree-roots-cache'
import {
  SshHostNotServedError,
  sshTargetNotConnectedMessage
} from '../providers/ssh-host-not-served-error'
import { runWorktreeChangeInvalidators } from '../ipc/worktree-change-invalidators'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { updateProjectHostSetupWithProvenKind } from '../folder-repo-git-conversion'
import type { RuntimeStore } from './runtime-store-contract'
import type { PrimaryWorkspaceTarget } from '../../shared/project-primary-removal'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { RuntimeProjectPrimaryWorkspaceController } from './runtime-project-primary-workspace-controller'
import { readAllWorktreeMetaForRepo } from '../persistence/host-qualified-worktree-meta'
import { readCurrentGitRemoteIdentity } from '../repo-git-remote-identity'
import {
  countRepoWorkspacesWithMetadata,
  describeProjectRemovalRefusal
} from './project-removal-impact'
import {
  assertWslMoveHostSetupIdWritable,
  assertWslMoveHostSetupWritable,
  assertWslMoveReposWritable
} from '../persistence/moving-wsl-projects/wsl-move-scope-guard'
import { runtimeVisibleProjectHostSetups } from './runtime-visible-catalog'
import {
  findProjectHostSetup,
  type ProjectHostSetupTarget
} from '../../shared/project-host-setup-target'

type RuntimeProjectHostSetupDependencies = {
  getStore: () => RuntimeStore | null
  listRepos: () => Repo[]
  addRepo: (path: string, kind: 'folder' | 'git', hostId: ExecutionHostId) => Promise<Repo>
  cloneRepo: (url: string, destination: string, hostId: ExecutionHostId) => Promise<Repo>
  invalidateResolvedWorktrees: () => void
  invalidateWorktreeScan: (repoId: string) => void
  notifyReposChanged: () => void
  listResolvedWorktrees?: () => Promise<ResolvedWorktree[]>
  verifyAuthoritativeWorktree?: (worktree: ResolvedWorktree) => Promise<boolean>
  listAuthenticatedRuntimeWorktrees?: (
    projectId: string,
    environmentId: string
  ) => Promise<ResolvedWorktree[]>
  getOwnPeerFingerprint?: () => string | null
  isDesktopAuthority?: () => boolean
  forwardPrimaryWorkspace?: (args: ProjectPrimarySelector) => Promise<Project>
  runPrimaryMutation?: <T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ) => Promise<T>
  flushPrimaryPersistence?: () => Promise<void>
  guardSetupRemoval?: <T>(setupId: string, operation: () => Promise<T>) => Promise<T>
  countLiveTerminalsForRepo?: (repo: Repo) => number
}

// Why clone refuses up front: `cloneRepo` runs `git clone` on the client, so accepting `ssh:*`
// here would register the client's copy as the host's repo — a local answer to a remote question.
function assertCloneHostIsSupported(hostId: ExecutionHostId | null | undefined): void {
  if (parseExecutionHostId(hostId)?.kind !== 'ssh') {
    return
  }
  throw new Error(
    'Cloning onto an SSH host is not supported. Clone the repository on the host, then set the project up from that existing folder.'
  )
}

export const SERVER_SSH_PROJECT_ADD_UNAVAILABLE_MESSAGE =
  "This Orca server can't add projects on its SSH hosts. Add the SSH host on your computer to open its projects."

function sshTargetNotServedError(connectionId: string): SshHostNotServedError {
  return new SshHostNotServedError(connectionId, sshTargetNotConnectedMessage(connectionId))
}

export class RuntimeProjectHostSetupController {
  private readonly primaryWorkspace: RuntimeProjectPrimaryWorkspaceController

  constructor(private readonly deps: RuntimeProjectHostSetupDependencies) {
    this.primaryWorkspace = new RuntimeProjectPrimaryWorkspaceController({
      getStore: () => this.deps.getStore(),
      listProjects: () => this.listProjects(),
      listSetups: () => this.listSetups(),
      listResolvedWorktrees: async () => {
        if (!this.deps.listResolvedWorktrees) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.listResolvedWorktrees()
      },
      listAuthenticatedRuntimeWorktrees: this.deps.listAuthenticatedRuntimeWorktrees,
      verifyAuthoritativeWorktree: async (worktree) => {
        if (!this.deps.verifyAuthoritativeWorktree) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.verifyAuthoritativeWorktree(worktree)
      },
      getOwnPeerFingerprint: () => this.deps.getOwnPeerFingerprint?.() ?? null,
      isDesktopAuthority: () => this.deps.isDesktopAuthority?.() ?? true,
      forwardPrimaryWorkspace: this.deps.forwardPrimaryWorkspace,
      runPrimaryMutation: async (projectId, target, operation) => {
        if (!this.deps.runPrimaryMutation) {
          throw new Error('runtime_unavailable')
        }
        return this.deps.runPrimaryMutation(projectId, target, operation)
      },
      flushPrimaryPersistence: async () => {
        if (!this.deps.flushPrimaryPersistence) {
          throw new Error('runtime_unavailable')
        }
        await this.deps.flushPrimaryPersistence()
      },
      invalidateResolvedWorktrees: () => this.deps.invalidateResolvedWorktrees(),
      notifyReposChanged: () => this.deps.notifyReposChanged()
    })
  }

  listProjects(): Project[] {
    return this.deps.getStore()?.getProjects?.() ?? []
  }

  updateProject(projectId: string, updates: ProjectUpdateArgs['updates']): Project {
    const store = this.deps.getStore()
    if (!store?.updateProject) {
      throw new Error('runtime_unavailable')
    }
    const existing = store.getProjects?.().find((entry) => entry.id === projectId)
    assertWslMoveReposWritable(store, existing?.sourceRepoIds ?? [])
    const project = store.updateProject(projectId, updates)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    this.deps.invalidateResolvedWorktrees()
    this.deps.notifyReposChanged()
    return project
  }

  setPrimaryWorkspace(args: ProjectPrimarySelector): Promise<Project> {
    return this.primaryWorkspace.set(args)
  }

  setPrimaryWorkspaceForPeer(
    args: ProjectPrimarySelector,
    environmentId: string
  ): Promise<Project> {
    return this.primaryWorkspace.setWithAuthenticatedPeer(args, environmentId)
  }

  async bindPrimaryAuthorityFingerprint(projectId: string, fingerprint: string): Promise<Project> {
    const store = this.deps.getStore()
    if (!store?.bindPrimaryAuthorityFingerprintDurably) {
      throw new Error('runtime_unavailable')
    }
    const project = await store.bindPrimaryAuthorityFingerprintDurably(projectId, fingerprint)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    this.deps.notifyReposChanged()
    return project
  }

  async applyPrimaryAuthoritySnapshot(input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }): Promise<Project> {
    const store = this.deps.getStore()
    if (!store?.applyPrimaryAuthoritySnapshotDurably) {
      throw new Error('runtime_unavailable')
    }
    const project = await store.applyPrimaryAuthoritySnapshotDurably(input)
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`)
    }
    this.deps.notifyReposChanged()
    return project
  }

  runPrimaryWorkspaceMutation<T>(
    projectId: string,
    target: PrimaryWorkspaceTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.deps.runPrimaryMutation) {
      throw new Error('runtime_unavailable')
    }
    return this.deps.runPrimaryMutation(projectId, target, operation)
  }

  listSetups(): ProjectHostSetup[] {
    return this.deps.getStore()?.getProjectHostSetups?.() ?? []
  }

  /** What clients may list; internal lookups keep the full store, as `listSetups` does. */
  listVisibleSetups(): ProjectHostSetup[] {
    return runtimeVisibleProjectHostSetups(this.deps.getStore())
  }

  createSetup(args: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult {
    const store = this.deps.getStore()
    if (!store?.createProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    assertWslMoveHostSetupWritable(store, args)
    const result = store.createProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project not found: ${args.projectId}`)
    }
    this.deps.notifyReposChanged()
    return result
  }

  async setupExistingFolder(
    args: ProjectHostSetupExistingFolderArgs
  ): Promise<ProjectHostSetupResult> {
    if (!this.deps.getStore()) {
      throw new Error('runtime_unavailable')
    }
    const kind = args.kind === 'folder' ? 'folder' : 'git'
    const knownRepoIds = new Set(this.deps.listRepos().map((repo) => repo.id))
    const sshTargetId = getSshTargetIdForExecutionHost(args.hostId)
    if (sshTargetId) {
      throw sshTargetNotServedError(sshTargetId)
    }
    const repo = await this.deps.addRepo(args.path, kind, args.hostId)
    const repoWasCreated = !knownRepoIds.has(repo.id)
    // Why: a registered row's stored remote can predate a remote the user has since added.
    const folderRemote =
      repoWasCreated && repo.gitRemoteIdentity !== undefined
        ? repo
        : await readCurrentGitRemoteIdentity(repo)
    return this.completeSetup(args, repo, repoWasCreated, folderRemote)
  }

  /**
   * `repo.addRemote` stays registered for older clients, which still offer it; this process serves
   * no SSH target, so the refusal says where such a project can be added instead.
   */
  addSshRepo(args: { connectionId: string }): Promise<Repo> {
    if (!this.deps.getStore()) {
      throw new Error('runtime_unavailable')
    }
    throw new SshHostNotServedError(args.connectionId, SERVER_SSH_PROJECT_ADD_UNAVAILABLE_MESSAGE)
  }

  async setupClone(args: ProjectHostSetupCloneArgs): Promise<ProjectHostSetupResult> {
    assertCloneHostIsSupported(args.hostId)
    const knownRepoIds = new Set(this.deps.listRepos().map((repo) => repo.id))
    const repo = await this.deps.cloneRepo(args.url, args.destination, args.hostId)
    return this.completeSetup(
      { ...args, path: repo.path, kind: 'git', setupMethod: 'cloned' },
      repo,
      !knownRepoIds.has(repo.id),
      // Why: a fresh clone's remote is not probed yet, and a Git-remote project links through it.
      repo.gitRemoteIdentity === undefined ? await readCurrentGitRemoteIdentity(repo) : repo
    )
  }

  // Why sync up front: availability and the WSL move fence refuse before any Git probe starts.
  updateSetup(args: ProjectHostSetupUpdateArgs): Promise<ProjectHostSetupUpdateResult> {
    const store = this.deps.getStore()
    const updateProjectHostSetup = store?.updateProjectHostSetup?.bind(store)
    if (!store || !updateProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    assertWslMoveHostSetupIdWritable(store, args)
    return this.finishSetupUpdate(store, updateProjectHostSetup, args)
  }

  private async finishSetupUpdate(
    store: RuntimeStore,
    updateProjectHostSetup: NonNullable<RuntimeStore['updateProjectHostSetup']>,
    args: ProjectHostSetupUpdateArgs
  ): Promise<ProjectHostSetupUpdateResult> {
    const result = await updateProjectHostSetupWithProvenKind(
      store,
      (setupArgs) => {
        assertWslMoveHostSetupIdWritable(store, setupArgs)
        return updateProjectHostSetup(setupArgs)
      },
      args,
      true
    )
    if (!result) {
      throw new Error(`Project host setup not found: ${args.setupId}`)
    }
    if ('worktreeBasePath' in args.updates && result.repo) {
      void prepareLocalWorktreeRootForRepo(store, result.repo)
      invalidateAuthorizedRootsCache()
    }
    if (result.repo && ('path' in args.updates || 'kind' in args.updates)) {
      this.retireRepoCatalog(result.repo.id)
    }
    this.deps.invalidateResolvedWorktrees()
    this.deps.notifyReposChanged()
    return result
  }

  deleteSetup(args: ProjectHostSetupDeleteArgs): Promise<ProjectHostSetupDeleteResult> {
    const store = this.deps.getStore()
    if (!store?.deleteProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    assertWslMoveHostSetupIdWritable(store, args)
    if (args.force === false) {
      this.assertSetupRemovalIsUnused(store, args)
    }
    if (!this.deps.flushPrimaryPersistence || !this.deps.guardSetupRemoval) {
      throw new Error('runtime_unavailable')
    }
    const remove = async () => {
      const result = store.deleteProjectHostSetup!(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      await this.deps.flushPrimaryPersistence!()
      return result
    }
    const guarded = this.deps.guardSetupRemoval(args.setupId, remove)
    return guarded.then((result) => {
      if (result.repo) {this.retireRepoCatalog(result.repo.id)}
      this.deps.invalidateResolvedWorktrees()
      this.deps.notifyReposChanged()
      return result
    })
  }

  // Why the shared invalidators: desktop and runtime scan caches key on repo id, not path or kind.
  private retireRepoCatalog(repoId: string): void {
    runWorktreeChangeInvalidators(repoId)
    invalidateAuthorizedRootsCache()
  }

  // Why only for an explicit `force: false`: older clients omit it and must keep their delete.
  private assertSetupRemovalIsUnused(store: RuntimeStore, target: ProjectHostSetupTarget): void {
    const setup = findProjectHostSetup(this.listSetups(), target)
    // Same exact-host match the store's delete uses, so a sibling host's row is never measured.
    const repo = setup?.repoId
      ? this.deps
          .listRepos()
          .find(
            (entry) => entry.id === setup.repoId && getRepoExecutionHostId(entry) === setup.hostId
          )
      : undefined
    if (!repo) {
      return
    }
    const refusal = describeProjectRemovalRefusal({
      liveTerminals: this.deps.countLiveTerminalsForRepo?.(repo) ?? 0,
      workspacesWithMetadata: countRepoWorkspacesWithMetadata(
        repo,
        // Host-qualified read: a same-id, same-path sibling host keeps its rows only in canonical maps.
        readAllWorktreeMetaForRepo(store, repo)
      )
    })
    if (refusal) {
      throw new Error(refusal)
    }
  }

  private completeSetup(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo,
    repoWasCreated: boolean,
    folderRemote: Pick<Repo, 'gitRemoteIdentity'>
  ): ProjectHostSetupResult {
    try {
      return this.linkRepo(args, initialRepo, folderRemote)
    } catch (error) {
      if (repoWasCreated) {
        // Why: host-scoped so a rollback never takes a same-id row on another host.
        this.deps.getStore()?.removeProjectForHost?.(initialRepo)
        this.deps.invalidateResolvedWorktrees()
        this.deps.invalidateWorktreeScan(initialRepo.id)
        invalidateAuthorizedRootsCache()
        this.deps.notifyReposChanged()
      }
      throw error
    }
  }

  private linkRepo(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo,
    folderRemote: Pick<Repo, 'gitRemoteIdentity'>
  ): ProjectHostSetupResult {
    const store = this.deps.getStore()
    if (!store) {
      throw new Error('runtime_unavailable')
    }
    assertWslMoveHostSetupWritable(store, {
      projectId: args.projectId,
      hostId: getRepoExecutionHostId(initialRepo),
      repoId: initialRepo.id
    })
    let repo = initialRepo
    let setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    if (setup.projectId !== args.projectId) {
      const existingProject = this.listProjects().find((project) => project.id === args.projectId)
      const updated = store.updateRepo(
        repo,
        resolveImportedFolderProjectLink(
          folderRemote,
          args.projectId,
          existingProject?.providerIdentity ?? args.projectProviderIdentity
        )
      )
      if (!updated) {
        throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
      }
      repo = updated
      setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    }
    const setupMethod = args.setupMethod ?? 'imported-existing-folder'
    const updated = store.updateRepo(repo, { projectHostSetupMethod: setupMethod })
    if (!updated) {
      throw new Error(
        `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
      )
    }
    repo = updated
    setup = getProjectHostSetupForRepo(this.listSetups(), repo)
    const project = this.listProjects().find((entry) => entry.id === setup.projectId)
    if (!project) {
      throw new Error(`Project setup was created without a project record: ${setup.projectId}`)
    }
    return { project, setup, repo }
  }
}
