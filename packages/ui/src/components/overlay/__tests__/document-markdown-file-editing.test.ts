import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('DocumentFormattedMarkdownOverlay file editing', () => {
  it('uses the rendered TipTap editor for file-backed .md editing', () => {
    const source = readFileSync(join(__dirname, '../DocumentFormattedMarkdownOverlay.tsx'), 'utf8')

    expect(source).toContain('TiptapMarkdownEditor')
    expect(source).toContain('<TiptapMarkdownEditor')
    expect(source).toContain('markdownEngine="official"')
    expect(source).not.toContain('<MarkdownSourceEditor')
  })
})
