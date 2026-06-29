import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// File-backed Markdown must edit the raw source. The rich TipTap editor can
// normalize or drop unsupported Markdown constructs such as GFM tables and
// complex fenced blocks, which makes a previewed .md file look like it lost
// body text as soon as edit mode opens.
describe('DocumentFormattedMarkdownOverlay file editing', () => {
  it('uses a raw Markdown source editor instead of TipTap for file-backed .md editing', () => {
    const source = readFileSync(join(__dirname, '../DocumentFormattedMarkdownOverlay.tsx'), 'utf8')

    expect(source).toContain('function MarkdownSourceEditor')
    expect(source).toContain('<MarkdownSourceEditor')
    expect(source).not.toContain('<TiptapMarkdownEditor')
  })
})
