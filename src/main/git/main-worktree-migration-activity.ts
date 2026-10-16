import type { ChildProcess } from 'node:child_process'

let admittedCommands = 0
const children = new Set<ChildProcess>()

export function trackGitAdmission(release: () => void): () => void {
  admittedCommands += 1
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    admittedCommands -= 1
    release()
  }
}

export function trackGitMigrationChild(child: ChildProcess): void {
  children.add(child)
  const finished = () => children.delete(child)
  child.once('close', finished)
}

export function assertNoGitActivityForMainMigration(): void {
  if (admittedCommands > 0 || children.size > 0) {
    throw new Error(
      'Git operations are still running. Wait for them to finish, then retry deleting the original checkout.'
    )
  }
}
