import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setAppEnvironment } from '../shared/app-environment'
import { currentWorkerEntryLayout, resolveWorkerThreadEntryPath } from './worker-thread-entry-path'

const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

function install(appPath: string, resourcesPath: string): void {
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
  setAppEnvironment({
    getPath: () => '/tmp',
    getAppPath: () => appPath,
    getVersion: () => '0.0.0-test',
    isPackaged: () => true,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
}

afterEach(() => {
  if (originalResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  } else {
    Reflect.deleteProperty(process, 'resourcesPath')
  }
})

describe('currentWorkerEntryLayout', () => {
  it('resolves entries inside the app.asar Electron actually loaded', () => {
    // A shared Electron (Nix wrapper) runs `electron <app>/resources/app.asar`.
    const appResources = join('/opt', 'orca', 'resources')
    install(join(appResources, 'app.asar'), join('/electron', 'resources'))
    expect(resolveWorkerThreadEntryPath(currentWorkerEntryLayout('/x'), 'w.js')).toBe(
      join(appResources, 'app.asar', 'out', 'main', 'w.js')
    )
  })

  it('keeps process.resourcesPath when the app is not an asar', () => {
    install(join('/repo'), join('/electron', 'resources'))
    expect(currentWorkerEntryLayout('/x').resourcesPath).toBe(join('/electron', 'resources'))
  })
})
