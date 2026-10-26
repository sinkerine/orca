import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import type { GlobalSettings } from '../../../shared/global-settings-types'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge(current: unknown, incoming: unknown): unknown {
  if (!isObject(incoming)) {
    return incoming
  }
  const result: Record<string, unknown> = isObject(current) ? { ...current } : {}
  for (const [key, value] of Object.entries(incoming)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new Error(`Invalid settings file key: ${key}`)
    }
    Object.defineProperty(result, key, {
      value: merge(result[key], value),
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  return result
}

/** Apply an optional administrator-supplied JSON settings overlay at startup. */
export function mergeSettingsFile(
  settings: GlobalSettings,
  path = process.env.ORCA_SETTINGS_FILE
): GlobalSettings {
  if (!path) {
    return settings
  }
  const declared: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isObject(declared)) {
    throw new Error('Orca settings file must contain a JSON object')
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The external overlay uses the same settings representation as persisted profile JSON.
  const merged = merge(settings, declared) as GlobalSettings
  return isDeepStrictEqual(settings, merged) ? settings : merged
}
