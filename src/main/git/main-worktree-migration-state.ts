import { resolve, relative, isAbsolute, sep } from 'node:path'

const unavailable = new Map<string, string>()

export function markMainMigrationUnavailable(paths: readonly string[], reason: string): void {
  for (const path of paths) {
    unavailable.set(resolve(path), reason)
  }
}

export function assertMainMigrationAvailable(cwd: string | undefined): void {
  if (!cwd) {
    return
  }
  for (const [path, reason] of unavailable) {
    const child = relative(path, resolve(cwd))
    if (child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))) {
      throw new Error(`Git checkout migration needs attention: ${reason}`)
    }
  }
}

export function clearMainMigrationUnavailable(paths: readonly string[]): void {
  for (const path of paths) {
    unavailable.delete(resolve(path))
  }
}
