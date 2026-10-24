import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPiImagePasteInputSourceLines } from './image-paste-input-source'
import { normalizeAgentLaunchVariants } from '../../shared/agent-launch-variants'
import { formatAgentImagePath } from '../../shared/agent-image-paste'

const folders: string[] = []
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
type Input = { text: string; images?: unknown[]; source?: string }
type Result = { action: string; text?: string; images?: unknown[] } | undefined

function fixture() {
  const folder = mkdtempSync(path.join(tmpdir(), 'orca-pi-image-'))
  folders.push(folder)
  const image = path.join(folder, 'orca-paste-123-abc.png')
  writeFileSync(image, png)
  return image
}

function handler(omp = false) {
  let onInput: ((event: Input, ctx: unknown) => Result) | undefined
  runInNewContext(`(function(pi) { ${getPiImagePasteInputSourceLines().join('\n')} })(pi)`, {
    pi: {
      on: (_name: string, callback: typeof onInput) => {
        onInput = callback
      }
    },
    process: { env: { ORCA_PANE_KEY: 'fixture' } },
    isOmpRuntime: () => omp,
    require: (name: string) => (name === 'fs' ? { readFileSync, statSync } : path)
  })
  return async (input: Input) => {
    const notify = vi.fn()
    const result = await onInput?.(input, { ui: { notify } })
    return { result, notify }
  }
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true })
  }
})

describe('Pi clipboard uploads become image content on the execution host', () => {
  it.each(['raw', 'variant', 'quoted'])(
    'attaches %s paths and preserves prompt text and existing images',
    async (mode) => {
      let image = fixture()
      if (mode === 'quoted') {
        image = path.join(path.dirname(image), 'orca-paste-456-def.png')
        const spacedFolder = mkdtempSync(path.join(tmpdir(), 'orca pi image '))
        folders.push(spacedFolder)
        image = path.join(spacedFolder, path.basename(image))
        writeFileSync(image, png)
      }
      const variant = normalizeAgentLaunchVariants([
        { id: 'custom', name: 'Custom Pi', agent: 'pi', command: 'custom-pi' }
      ])[0]
      const reference = mode === 'raw' ? image : formatAgentImagePath(variant.agent, image)
      const existing = { type: 'image', data: 'existing', mimeType: 'image/png' }
      const { result } = await handler()({ text: `Inspect ${reference}`, images: [existing] })
      expect(result).toEqual({
        action: 'transform',
        text: 'Inspect',
        images: [existing, { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }]
      })
    }
  )

  it('blocks a missing upload instead of sending an inaccessible path to the model', async () => {
    const image = fixture()
    rmSync(image)
    const { result, notify } = await handler()({ text: image })
    expect(result).toEqual({ action: 'handled' })
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('agent host'), 'error')
  })

  it('attaches multiple uploads in order', async () => {
    const first = fixture()
    const second = fixture()
    const { result } = await handler()({ text: `${first} ${second} compare` })
    expect(result?.text).toBe('compare')
    expect(result?.images).toHaveLength(2)
  })

  it('rejects a non-PNG upload', async () => {
    const image = fixture()
    writeFileSync(image, 'not a PNG image')
    const { result, notify } = await handler()({ text: image })
    expect(result).toEqual({ action: 'handled' })
    expect(notify).toHaveBeenCalled()
  })

  it('leaves unrelated paths, extension input and OMP untouched', async () => {
    expect((await handler()({ text: '/tmp/photo.png' })).result).toBeUndefined()
    const image = fixture()
    expect((await handler()({ text: image, source: 'extension' })).result).toBeUndefined()
    expect((await handler(true)({ text: image })).result).toBeUndefined()
  })
})
