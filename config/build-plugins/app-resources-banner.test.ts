import { join, posix, win32 } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createAppResourcesBanner } from './app-resources-banner'

describe('application resources bootstrap', () => {
  it.each([posix, win32])('resolves app resources before modules load with %o', (path) => {
    const resources = path.join('install', 'orca', 'resources')
    const processMock = { type: 'browser', resourcesPath: 'shared-electron-resources' }
    runInNewContext(createAppResourcesBanner(), {
      process: processMock,
      require: (name: string) =>
        name === 'electron' ? { app: { getAppPath: () => path.join(resources, 'app.asar') } } : path
    })
    expect(processMock.resourcesPath).toBe(resources)
  })

  it('leaves development resources unchanged', async () => {
    const path = await import('node:path')
    const processMock = { type: 'browser', resourcesPath: 'electron-resources' }
    runInNewContext(createAppResourcesBanner(), {
      process: processMock,
      require: (name: string) =>
        name === 'electron' ? { app: { getAppPath: () => join('checkout', 'orca') } } : path
    })
    expect(processMock.resourcesPath).toBe('electron-resources')
  })

  it('does not load Electron in a plain Node process', () => {
    const processMock = {}
    runInNewContext(createAppResourcesBanner(), {
      process: processMock,
      require: () => {
        throw new Error('Electron unavailable')
      }
    })
    expect(processMock).toEqual({})
  })
})
