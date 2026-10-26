import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { getDefaultPersistedState } from '../../../shared/constants'
import { mergeSettingsFile } from './settings-file'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function settingsFile(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeFileSync(path, content)
  return path
}

it('merges nested settings and replaces arrays without mutating the profile', () => {
  const settings = getDefaultPersistedState(tmpdir()).settings
  const original = structuredClone(settings)
  const merged = mergeSettingsFile(
    settings,
    settingsFile(
      JSON.stringify({
        theme: 'dark',
        agentDefaultEnv: { claude: { EXAMPLE: 'yes' } },
        disabledTuiAgents: []
      })
    )
  )
  expect(merged.theme).toBe('dark')
  expect(merged.agentDefaultEnv?.claude).toEqual(expect.objectContaining({ EXAMPLE: 'yes' }))
  expect(merged.disabledTuiAgents).toEqual([])
  expect(settings).toEqual(original)
})

it('preserves identity when the overlay makes no changes', () => {
  const settings = getDefaultPersistedState(tmpdir()).settings
  expect(mergeSettingsFile(settings, '')).toBe(settings)
  expect(mergeSettingsFile(settings, settingsFile('{}'))).toBe(settings)
})

it('reports missing, malformed and non-object configured files', () => {
  const settings = getDefaultPersistedState(tmpdir()).settings
  expect(() => mergeSettingsFile(settings, settingsFile('invalid'))).toThrow()
  expect(() => mergeSettingsFile(settings, settingsFile('[]'))).toThrow('JSON object')
  const missing = settingsFile('{}')
  rmSync(missing)
  expect(() => mergeSettingsFile(settings, missing)).toThrow()
})

it('rejects prototype keys even when nested', () => {
  const settings = getDefaultPersistedState(tmpdir()).settings
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    expect(() =>
      mergeSettingsFile(settings, settingsFile(`{"agentDefaultEnv":{"${key}":{}}}`))
    ).toThrow('Invalid settings file key')
  }
})
