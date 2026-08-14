import { describe, expect, it } from 'bun:test'
import {
  isPreviewContentPending,
  shouldShowMissingPreviewMessage,
} from '../markdown-preview-limits'

describe('markdown preview loading vs missing content', () => {
  it('treats null content as still loading, not a missing-file error', () => {
    expect(isPreviewContentPending(null)).toBe(true)
    expect(shouldShowMissingPreviewMessage(null)).toBe(false)
    expect(shouldShowMissingPreviewMessage('')).toBe(true)
  })

  it('does not show the missing-file message when a read error is already present', () => {
    expect(shouldShowMissingPreviewMessage('', 'Request timeout: file:readPreview (30000ms)')).toBe(false)
  })
})
