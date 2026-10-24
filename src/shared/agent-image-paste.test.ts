import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { formatAgentImagePath, getAgentImageHandling } from './agent-image-paste'

it('Pi uses quoted file references that its managed input handler attaches', () => {
  expect(getAgentImageHandling('pi')).toBe('attachment')
  expect(formatAgentImagePath('pi', '/tmp/screen shot/orca-paste-1-abc.png')).toBe(
    '@"/tmp/screen shot/orca-paste-1-abc.png"'
  )
})

describe('OMP image references', () => {
  it.each([
    ['/tmp/screen@2x.png', '@"/tmp/screen@2x.png"'],
    ['/tmp/a "quote".png', `@'/tmp/a "quote".png'`],
    ["/tmp/a 'quote'.png", `@"/tmp/a 'quote'.png"`],
    ['C:\\Images\\screen shot.png', '@"C:\\Images\\screen shot.png"']
  ])('quotes %s for file-mention parsing', (path, expected) => {
    expect(formatAgentImagePath('omp', path)).toBe(expected)
    expect(formatAgentImagePath('claude', path)).toBe(path)
  })

  it.each([
    `/tmp/a "both' quotes.png`,
    `/tmp/a "both' quotes/image.png`,
    `/tmp/a "both' @quotes#100%.png`,
    `/tmp/a "both' \\quotes.png`,
    `C:\\Images\\a "both' quotes.png`,
    `\\\\server\\share\\a "both' quotes.png`
  ])('round trips unquotable absolute paths through OMP file URLs: %s', (path) => {
    const mention = formatAgentImagePath('omp', path)
    const encodedPath = /^@"([^"]+)"$/.exec(mention)?.[1]
    expect(encodedPath).toBeDefined()
    expect(fileURLToPath(encodedPath!, { windows: !path.startsWith('/') })).toBe(path)
    expect(formatAgentImagePath('claude', path)).toBe(path)
  })
})
