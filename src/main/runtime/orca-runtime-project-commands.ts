// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithProjectPrimaryRemoval } from './orca-runtime-project-primary-removal'
import { RuntimeProjectGroupController } from './runtime-project-group-controller'
import { RuntimeNestedRepoImport } from './runtime-nested-repo-import'
import { RuntimeRepositoryRegistrationController } from './runtime-repository-registration-controller'
import { RuntimeRepositoryCloneController } from './runtime-repository-clone-controller'
import { RuntimeRepositorySettingsController } from './runtime-repository-settings-controller'
import { RuntimeRepositorySparsePresets } from './runtime-repository-sparse-presets'
import { RuntimeRepositoryRefQueries } from './runtime-repository-ref-queries'
import { RuntimeServerEnvironmentCommands } from './runtime-server-environment-commands'
import { RuntimeRepositoryForkBackfill } from './runtime-repository-fork-backfill'
import { RuntimeWorkspaceSessionController } from './runtime-workspace-session-controller'
import { RuntimeAiVaultCommands } from './runtime-ai-vault-commands'
import { ClaudeAgentTeamsService } from './claude-agent-teams-service'
import { teardownFolderWorkspacePtys } from './folder-workspace-pty-teardown'

export class OrcaRuntimeWithProjectCommands extends OrcaRuntimeWithProjectPrimaryRemoval {
  protected readonly projectGroups = new RuntimeProjectGroupController({
    getStore: () => this.store,
    resolveRepo: (selector) => this.resolveRepoSelector(selector),
    notifyReposChanged: () => this.notifyReposChanged(),
    resolveFolderConnectionId: (workspace) => this.resolveFolderWorkspaceConnectionId(workspace),
    teardownFolderWorkspacePtys: (worktreeId, connectionId) =>
      teardownFolderWorkspacePtys(
        {
          runtime: this,
          getSshProvider: this.getSshProviderFn,
          getLocalProvider: () => this.getLocalProvider(),
          onPtyStopped: this.onPtyStopped
        },
        worktreeId,
        connectionId
      ),
    cleanupRemovedFolderWorkspaceState: (worktreeId) => {
      if (this.store) {
        this.removeWorktreeMetadataAndHistory(this.store, worktreeId)
      }
    }
  })

  protected readonly nestedRepoImport = new RuntimeNestedRepoImport({
    getStore: () => this.store,
    invalidateResolvedWorktrees: () => this.invalidateResolvedWorktreeCache(),
    invalidateWorktreeScan: (repoId) => this.invalidateWorktreeScanCacheForRepo(repoId),
    notifyReposChanged: () => this.notifyReposChanged(),
    guardPrimaryProjectRemoval: (repoId, hostId, operation) =>
      this.primaryRemoval.guardProjectRemoval(repoId, hostId, operation)
  })

  protected readonly repositoryRegistrations = new RuntimeRepositoryRegistrationController({
    getStore: () => this.store,
    invalidateResolvedWorktrees: () => this.invalidateResolvedWorktreeCache(),
    invalidateWorktreeScan: (repoId) => this.invalidateWorktreeScanCacheForRepo(repoId),
    notifyReposChanged: () => this.notifyReposChanged()
  })

  protected readonly repositoryClones = new RuntimeRepositoryCloneController({
    getStore: () => this.store,
    invalidateResolvedWorktrees: () => this.invalidateResolvedWorktreeCache(),
    invalidateWorktreeScan: (repoId) => this.invalidateWorktreeScanCacheForRepo(repoId),
    notifyReposChanged: () => this.notifyReposChanged()
  })

  protected readonly repositorySettings = new RuntimeRepositorySettingsController({
    getStore: () => this.store,
    resolveRepo: (selector) => this.resolveRepoSelector(selector),
    guardPrimaryProjectRemoval: (repoId, hostId, operation) =>
      this.primaryRemoval.guardProjectRemoval(repoId, hostId, operation),
    forgetTerminalTopology: (repoId) => this.terminalTopologyRevisionByRepoId.delete(repoId),
    invalidateResolvedWorktrees: () => this.invalidateResolvedWorktreeCache(),
    invalidateWorktreeScan: (repoId) => this.invalidateWorktreeScanCacheForRepo(repoId),
    notifyReposChanged: () => this.notifyReposChanged()
  })

  protected readonly repositorySparsePresets = new RuntimeRepositorySparsePresets({
    getStore: () => this.store,
    resolveRepo: (selector) => this.resolveRepoSelector(selector)
  })

  protected readonly repositoryRefQueries = new RuntimeRepositoryRefQueries({
    resolveRepo: (selector) => this.resolveRepoSelector(selector)
  })

  protected readonly serverEnvironment = new RuntimeServerEnvironmentCommands()

  protected readonly repositoryForkBackfill = new RuntimeRepositoryForkBackfill(
    () => this.store,
    () => this.notifyReposChanged()
  )

  protected readonly workspaceSessions = new RuntimeWorkspaceSessionController({
    getStore: () => this.store,
    resolveFolderConnectionId: (workspace) => this.resolveFolderWorkspaceConnectionId(workspace),
    hasRuntimeOwnedPtyCandidate: (session, worktreeId, tabs) =>
      this.workspaceSessionWorktreeHasRuntimeOwnedPtyCandidate(session, worktreeId, tabs)
  })

  protected readonly aiVault = new RuntimeAiVaultCommands(() => this.prepareAiVaultSessionResumeFn)

  protected readonly claudeAgentTeams = new ClaudeAgentTeamsService()
}
