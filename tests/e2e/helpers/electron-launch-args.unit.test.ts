import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrcaElectronLaunchArgs } from './electron-launch-args'

describe('getOrcaElectronLaunchArgs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['linux', 'true', true, true],
    ['linux', undefined, true, false],
    ['linux', 'true', false, false],
    ['darwin', 'true', true, false],
    ['win32', 'true', true, false]
  ] as const)(
    'scopes software WebGL to Linux CI headful launches: %s/%s/%s',
    (platform, ci, headful, enabled) => {
      vi.stubGlobal('process', { ...process, platform, env: { ...process.env, CI: ci } })
      const args = getOrcaElectronLaunchArgs(join('orca', 'out', 'main', 'index.js'), headful)
      expect(args.includes('--use-gl=angle')).toBe(enabled)
      expect(args.includes('--use-angle=swiftshader')).toBe(enabled)
      expect(args.includes('--enable-unsafe-swiftshader')).toBe(enabled)
      if (enabled) {
        expect(args).toContain('--disable-gpu-sandbox')
        expect(args).not.toContain('--disable-gpu')
      }
    }
  )

  it.each([
    ['linux', '1', false, true],
    ['linux', undefined, false, false],
    ['linux', '1', true, false],
    ['darwin', '1', false, false]
  ] as const)(
    'scopes offscreen ozone to opted-in Linux headless launches: %s/%s/%s',
    (platform, optIn, headful, enabled) => {
      vi.stubGlobal('process', {
        ...process,
        platform,
        env: { ...process.env, CI: undefined, ORCA_E2E_OFFSCREEN_OZONE: optIn }
      })
      const args = getOrcaElectronLaunchArgs(join('orca', 'out', 'main', 'index.js'), headful)
      expect(args.includes('--ozone-platform=headless')).toBe(enabled)
    }
  )

  it('launches the package root that owns the compiled main entry', () => {
    const root = join('workspace', 'orca')
    const mainPath = join(root, 'out', 'main', 'index.js')

    const args = getOrcaElectronLaunchArgs(mainPath, true)
    if (process.platform === 'darwin') {
      expect(args).toEqual([
        '--password-store=basic',
        '--use-mock-keychain',
        root,
        '-ApplePersistenceIgnoreState',
        'YES'
      ])
    } else {
      expect(args.at(-1)).toBe(root)
    }
    expect(getOrcaElectronLaunchArgs(mainPath, false)).toContain(root)
  })
})
