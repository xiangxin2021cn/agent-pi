import { describe, expect, it } from 'bun:test'
import type { NavigationState } from '../../../shared/types'
import { getSourceRouteForNavigation } from '../nav-helpers'

describe('getSourceRouteForNavigation', () => {
  it('preserves the knowledge base source filter when selecting a source', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      filter: { kind: 'knowledgeBase' },
      details: null,
    }

    expect(getSourceRouteForNavigation(navState, 'file-memory-c5-2')).toBe('sources/knowledge-base/source/file-memory-c5-2')
  })

  it('preserves typed source filters when selecting a source', () => {
    const navState: NavigationState = {
      navigator: 'sources',
      filter: { kind: 'type', sourceType: 'mcp' },
      details: null,
    }

    expect(getSourceRouteForNavigation(navState, 'anysearch-mcp')).toBe('sources/mcp/source/anysearch-mcp')
  })
})
