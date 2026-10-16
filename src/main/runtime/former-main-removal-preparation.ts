import type { Repo } from '../../shared/repo-types'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { RuntimeStore } from './runtime-store-contract'
import type { LocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { prepareFormerMainWorktreeDeletion } from '../main-worktree-deletion'
import { listWorktreesStrict } from '../git/worktree'

export async function prepareRuntimeFormerMainRemoval<T>(args: {
  store: RuntimeStore
  repo: Repo
  worktreePath: string
  registeredWorktrees: GitWorktreeInfo[]
  force: boolean
  localOptions: LocalProjectWorktreeGitOptions
  beginPrimaryRemoval: () => Promise<T>
  cancelPrimaryRemoval: (permit: T) => Promise<void>
  notifyReposChanged: () => void
}): Promise<{ repo: Repo; registeredWorktrees: GitWorktreeInfo[]; primaryRemoval: T | null }> {
  if (
    !args.registeredWorktrees.some((row) => row.path === args.worktreePath && row.isMainWorktree)
  ) {
    return { repo: args.repo, registeredWorktrees: args.registeredWorktrees, primaryRemoval: null }
  }
  const primaryRemoval = await args.beginPrimaryRemoval()
  let repo: Repo
  try {
    repo = prepareFormerMainWorktreeDeletion({ ...args, wslDistro: args.localOptions.wslDistro })
  } catch (error) {
    await args.cancelPrimaryRemoval(primaryRemoval)
    throw error
  }
  args.notifyReposChanged()
  return {
    repo,
    primaryRemoval,
    registeredWorktrees: await listWorktreesStrict(repo.path, args.localOptions)
  }
}
