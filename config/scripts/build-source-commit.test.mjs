import { expect, it, vi } from 'vitest'
import { resolveBuildSourceCommit } from './build-source-commit.mjs'

it('supports source archives with an explicit full commit without invoking Git', () => {
  const readCommit = vi.fn(() => {
    throw new Error('no git checkout')
  })
  const commit = 'a'.repeat(40)
  expect(resolveBuildSourceCommit({ env: { ORCA_BUILD_COMMIT: commit }, readCommit })).toBe(commit)
  expect(readCommit).not.toHaveBeenCalled()
})

it('reads Git when no commit override is supplied', () => {
  expect(resolveBuildSourceCommit({ env: {}, readCommit: () => 'b'.repeat(40) })).toBe(
    'b'.repeat(40)
  )
})

it('rejects invalid explicit identities instead of falling back to Git', () => {
  const readCommit = vi.fn(() => 'b'.repeat(40))
  expect(() =>
    resolveBuildSourceCommit({ env: { ORCA_BUILD_COMMIT: 'short' }, readCommit })
  ).toThrow('full commit hash')
  expect(readCommit).not.toHaveBeenCalled()
})
