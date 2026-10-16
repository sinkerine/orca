import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export function refuseMainMigration(reason: string): never {
  throw new Error(`Cannot delete the original checkout: ${reason}. The repository was kept.`)
}

export function migrationPathContains(parent: string, child: string): boolean {
  const value = relative(parent, child)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

export function assertOrdinaryMigrationDirectory(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
    refuseMainMigration(`unsupported or symlinked Git directory at ${path}`)
  }
}

export function assertOrdinaryMigrationMetadata(path: string, common = false): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name.endsWith('.lock')) {
      refuseMainMigration(`busy or linked Git metadata at ${path}`)
    }
    if (
      [
        'rebase-merge',
        'rebase-apply',
        'sequencer',
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'BISECT_LOG',
        'MERGE_MSG',
        'SQUASH_MSG',
        'MERGE_MODE',
        'config.worktree',
        'modules'
      ].includes(entry.name)
    ) {
      refuseMainMigration(`unsupported Git operation or configuration: ${entry.name}`)
    }
    if (entry.isDirectory() && (!common || !['objects', 'refs', 'hooks'].includes(entry.name))) {
      assertOrdinaryMigrationMetadata(join(path, entry.name))
    }
  }
}
