import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import {
  applyMigrationJournal,
  finishMigrationJournal,
  readMainMigrationJournals
} from '../../git/main-worktree-migration-journal'
import {
  markMainMigrationUnavailable,
  clearMainMigrationUnavailable
} from '../../git/main-worktree-migration-state'
import { verifyMainWorktreeMigration } from '../../git/main-worktree-migration'
import type { StoreRuntimeState } from './store-runtime-state'
import type { StoreDomains } from './store-domain-composition'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { PrimaryRemovalReservation } from '../../../shared/project-primary-removal'
import type { ProjectPrimaryAuthorityPersistence } from './project-primary-authority-persistence'
import { scheduleSave } from './write-scheduling'
export abstract class ProjectPrimaryStoreOperations {
  protected abstract readonly state: PersistedState
  protected abstract readonly domains: StoreDomains
  protected abstract readonly runtime: StoreRuntimeState
  protected abstract readonly primaryAuthorityPersistence: ProjectPrimaryAuthorityPersistence
  protected abstract flushPrimaryStoreSync(): void
  protected abstract flushPrimaryStore(): Promise<void>
  abstract freezeWrites(): void
  getPrimaryRemovalReservations(): readonly PrimaryRemovalReservation[] {
    return (this.state.primaryRemovalReservations ?? []).map((reservation) => ({
      ...reservation,
      target: { ...reservation.target }
    }))
  }

  get isPrimaryWorkspaceMutationAvailable(): boolean {
    return this.primaryAuthorityPersistence.isAvailable
  }

  async bindPrimaryAuthorityFingerprintDurably(
    id: string,
    fingerprint: string
  ): Promise<Project | null> {
    return this.primaryAuthorityPersistence.bind(id, fingerprint)
  }

  async registerRemoteProjectAuthorityCompatibilityDurably(input: {
    remoteProject: Project
    hostId: ProjectHostSetup['hostId']
    setups: readonly ProjectHostSetup[]
    authorityFingerprint: string
    runtimeOwnerFingerprint?: string
    isCurrent?: () => boolean
  }): Promise<Project> {
    const priorProjects = structuredClone(this.state.projects)
    const priorSetups = structuredClone(this.state.projectHostSetups)
    try {
      if (input.isCurrent && !input.isCurrent()) {
        throw new Error('runtime_environment_changed')
      }
      const { isCurrent, ...registration } = input
      const project =
        this.domains.projects.registerRemoteProjectAuthorityCompatibility(registration)
      await this.flushPrimaryStore()
      if (isCurrent && !isCurrent()) {
        throw new Error('runtime_environment_changed')
      }
      return project
    } catch (error) {
      this.state.projects = priorProjects
      this.state.projectHostSetups = priorSetups
      scheduleSave(this.domains.scheduling)
      try {
        await this.flushPrimaryStore()
      } catch {
        this.freezeWrites()
        throw new Error('remote_project_compatibility_rollback_failed', { cause: error })
      }
      throw error
    }
  }

  async applyPrimaryAuthoritySnapshotDurably(input: {
    projectId: string
    fingerprint: string
    primaryWorkspace: Project['primaryWorkspace'] | null | undefined
    revision: number
  }): Promise<Project | null> {
    return this.primaryAuthorityPersistence.applySnapshot(input)
  }

  async setPrimaryWorkspaceDurably(
    id: string,
    primary: Project['primaryWorkspace'] | undefined
  ): Promise<Project | null> {
    return this.primaryAuthorityPersistence.set(id, primary)
  }

  async savePrimaryRemovalReservation(reservation: PrimaryRemovalReservation): Promise<void> {
    const reservations = this.state.primaryRemovalReservations ?? []
    if (reservations.some((entry) => entry.token === reservation.token)) {
      throw new Error('duplicate_primary_removal_token')
    }
    this.state.primaryRemovalReservations = [
      ...reservations,
      {
        ...reservation,
        target: { ...reservation.target }
      }
    ]
    scheduleSave(this.domains.scheduling)
    await this.flushPrimaryStore()
  }

  async removePrimaryRemovalReservation(token: string): Promise<void> {
    const reservations = this.state.primaryRemovalReservations ?? []
    this.state.primaryRemovalReservations = reservations.filter((entry) => entry.token !== token)
    scheduleSave(this.domains.scheduling)
    try {
      await this.flushPrimaryStore()
    } catch (error) {
      this.state.primaryRemovalReservations = reservations
      scheduleSave(this.domains.scheduling)
      throw error
    }
  }

  rebindLocalRepositoryAnchor(repoId: string, oldPath: string, newPath: string): void {
    const repo = this.state.repos.find(
      (entry) => entry.id === repoId && getRepoExecutionHostId(entry) === 'local'
    )
    if (!repo || (repo.path !== oldPath && repo.path !== newPath)) {
      throw new Error('Repository anchor changed during Git checkout migration')
    }
    if (repo.worktreeBasePath && !isAbsolute(repo.worktreeBasePath)) {
      repo.worktreeBasePath = resolve(oldPath, repo.worktreeBasePath)
    }
    repo.path = newPath
    for (const setup of this.state.projectHostSetups) {
      if (setup.repoId === repoId && setup.hostId === 'local') {
        setup.path = newPath
        if (repo.worktreeBasePath) {
          setup.worktreeBasePath = repo.worktreeBasePath
        }
      }
    }
    scheduleSave(this.domains.scheduling)
    this.flushPrimaryStoreSync()
  }

  protected recoverMainWorktreeMigrations(): void {
    for (const { path, journal } of readMainMigrationJournals(dirname(this.runtime.dataFile))) {
      const repo = this.state.repos.find(
        (entry) => entry.id === journal.repoId && getRepoExecutionHostId(entry) === 'local'
      )
      try {
        if (!repo || (repo.path !== journal.oldPath && repo.path !== journal.newPath)) {
          throw new Error(`Git migration recovery requires the original repository anchor: ${path}`)
        }
        applyMigrationJournal(path, journal)
        verifyMainWorktreeMigration(journal)
        this.rebindLocalRepositoryAnchor(journal.repoId, journal.oldPath, journal.newPath)
        finishMigrationJournal(path, journal)
        clearMainMigrationUnavailable([journal.oldPath, journal.newPath])
      } catch (error) {
        markMainMigrationUnavailable(
          [
            journal.oldPath,
            journal.newPath,
            ...journal.operations.flatMap((operation) =>
              operation.kind === 'write' && basename(operation.path) === '.git'
                ? [dirname(operation.path)]
                : []
            )
          ],
          `${path}: ${String(error)}`
        )
        console.error(
          '[git-migration] Repository needs recovery; other projects remain available:',
          path,
          error
        )
      }
    }
  }
}

export const profileStorageDirectory = (dataFile: string): string => dirname(dataFile)
