import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPendingTextFilePreview, type FilePreviewState } from '../useLinkInterceptor'

describe('pending in-app file preview', () => {
  it('opens markdown overlays with null content instead of an empty string', () => {
    const source = readFileSync(join(__dirname, '../useLinkInterceptor.ts'), 'utf8')
    expect(source).not.toContain("content: type === 'json' ? '{}' : ''")
    expect(source).toContain('...buildInitialTextState(type, path)')
  })

  it('waits for file:readPreview instead of aborting the overlay on the default RPC timeout', () => {
    const source = readFileSync(join(__dirname, '../../../transport/channel-map.ts'), 'utf8')
    expect(source).toContain('readFilePreview: invoke(RPC_CHANNELS.file.READ_PREVIEW, undefined, { timeoutMs: 0 })')
  })

  it('treats markdown content=null as loading, not as a finished empty preview', () => {
    const state = {
      type: 'markdown',
      filePath: 'C:/tmp/boq.md',
      content: null,
    } satisfies FilePreviewState
    expect(isPendingTextFilePreview(state)).toBe(true)
  })

  it('stops treating the preview as pending after a successful or failed read', () => {
    expect(isPendingTextFilePreview({
      type: 'markdown',
      filePath: 'C:/tmp/boq.md',
      content: '# loaded',
    })).toBe(false)
    expect(isPendingTextFilePreview({
      type: 'markdown',
      filePath: 'C:/tmp/boq.md',
      content: '',
      error: 'Failed to read file preview',
    })).toBe(false)
  })
})
