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

  it('previews AI selection rewrites before applying them', () => {
    const source = readFileSync(join(__dirname, '../DocumentFormattedMarkdownOverlay.tsx'), 'utf8')

    expect(source).toContain('rewritePreview')
    expect(source).toContain('Review AI rewrite before applying')
    expect(source).toContain('handleApplyRewritePreview')
    expect(source).toContain('Original')
    expect(source).toContain('Proposed')
    expect(source).toContain("rewritePreview == null ? 'Preview' : 'Apply'")
  })

  it('shows a loading state instead of treating empty pending content as a missing file', () => {
    const source = readFileSync(join(__dirname, '../DocumentFormattedMarkdownOverlay.tsx'), 'utf8')
    expect(source).toContain('preview.loadingFile')
    expect(source).toContain('preview.noContent')
    expect(source).toContain('isPreviewContentPending')
    expect(source).toContain('shouldShowMissingPreviewMessage')
    expect(source).not.toContain('isMarkdownTooHeavyForRichPreview')
    expect(source).not.toContain('preview.largeFilePlain')
    expect(source).not.toContain('No preview content was returned for this file.')
  })
})
