import { defineMethod } from '../core'
import { PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { projectRepoResultVisibilityForClient } from '../repo-visibility-projection'
import {
  ProjectHostSetupClone,
  ProjectHostSetupCreate,
  ProjectHostSetupDelete,
  ProjectHostSetupExistingFolder,
  ProjectHostSetupUpdate,
  ProjectUpdate,
  ProjectPrimaryGet,
  ProjectPrimarySet
} from '../../../../shared/rpc-contract/project-runtime-params'

export const PROJECT_RUNTIME_METHODS = [
  defineMethod({
    name: 'project.list',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => {
      runtime.enrichMissingRepoGitRemoteIdentities?.()
      return { projects: runtime.listProjects() }
    }
  }),
  defineMethod({
    name: 'project.primary.get',
    permission: 'workspace',
    params: ProjectPrimaryGet,
    handler: async (rawParams, { runtime, clientKind, clientCapabilities }) => {
      if (
        clientKind === 'runtime' &&
        !clientCapabilities?.includes(PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY)
      ) {
        throw new Error('primary_authority_capability_required')
      }
      const params = ProjectPrimaryGet.parse(rawParams)
      const project = runtime.listProjects().find((entry) => entry.id === params.projectId)
      if (!project) {
        throw new Error(`Project not found: ${params.projectId}`)
      }
      return {
        primaryWorkspace: project.primaryWorkspace,
        revision: project.primaryWorkspaceRevision ?? 0
      }
    }
  }),
  defineMethod({
    name: 'project.primary.set',
    permission: 'workspace',
    params: ProjectPrimarySet,
    handler: async (rawParams, { runtime, clientKind, clientCapabilities }) => {
      if (
        clientKind === 'runtime' &&
        !clientCapabilities?.includes(PROJECT_PRIMARY_AUTHORITY_RUNTIME_CAPABILITY)
      ) {
        throw new Error('primary_authority_capability_required')
      }
      const params = ProjectPrimarySet.parse(rawParams)
      const project = await runtime.setPrimaryWorkspace(params)
      return {
        primaryWorkspace: project.primaryWorkspace,
        revision: project.primaryWorkspaceRevision ?? 0,
        project
      }
    }
  }),
  defineMethod({
    name: 'project.update',
    permission: 'workspace',
    params: ProjectUpdate,
    handler: (params, { runtime }) => ({
      project: runtime.updateProject(params.projectId, params.updates)
    })
  }),
  defineMethod({
    name: 'projectHostSetup.list',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime }) => {
      runtime.enrichMissingRepoGitRemoteIdentities?.()
      return { setups: runtime.listVisibleProjectHostSetups() }
    }
  }),
  defineMethod({
    name: 'projectHostSetup.create',
    permission: 'workspace',
    params: ProjectHostSetupCreate,
    handler: (params, { runtime }) => ({
      result: runtime.createProjectHostSetup(params)
    })
  }),
  defineMethod({
    name: 'projectHostSetup.setupExistingFolder',
    permission: 'workspace',
    params: ProjectHostSetupExistingFolder,
    handler: async (params, context) => ({
      result: projectRepoResultVisibilityForClient(
        await context.runtime.setupProjectExistingFolder(params),
        context
      )
    })
  }),
  defineMethod({
    name: 'projectHostSetup.clone',
    permission: 'workspace',
    params: ProjectHostSetupClone,
    handler: async (params, context) => ({
      result: projectRepoResultVisibilityForClient(
        await context.runtime.setupProjectClone(params),
        context
      )
    })
  }),
  defineMethod({
    name: 'projectHostSetup.update',
    permission: 'workspace',
    params: ProjectHostSetupUpdate,
    handler: async (params, context) => ({
      result: projectRepoResultVisibilityForClient(
        await context.runtime.updateProjectHostSetup(params),
        context
      )
    })
  }),
  defineMethod({
    name: 'projectHostSetup.delete',
    permission: 'workspace',
    params: ProjectHostSetupDelete,
    handler: async (params, context) => ({
      result: projectRepoResultVisibilityForClient(
        await context.runtime.deleteProjectHostSetup(params),
        context
      )
    })
  })
]
