import { describe, it, expect } from 'bun:test'
import { computeCollapsedPagination } from '../useSessionSearch'
import type { SessionMeta } from '@/atoms/sessions'

function makeSession(id: string, opts: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    workspaceId: 'ws-1',
    sessionStatus: 'in-progress',
    lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z'),
    ...opts,
  }
}

describe('computeCollapsedPagination', () => {
  it('does not hide items when current view has only one group and that group is collapsed', () => {
    const sessions = [
      makeSession('s1'),
      makeSession('s2'),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['s1', 's2'])
    expect(result.collapsedGroupsMeta).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('still collapses normally when multiple groups exist', () => {
    const sessions = [
      makeSession('today', { lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z') }),
      makeSession('yesterday', { lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z') }),
      makeSession('older', { lastMessageAt: Date.parse('2026-03-04T10:00:00.000Z') }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['2026-03-05T00:00:00.000Z']),
      'date'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['today', 'older'])
    expect(result.collapsedGroupsMeta).toEqual([{
      key: '2026-03-05T00:00:00.000Z',
      count: 1,
      latestAt: Date.parse('2026-03-05T10:00:00.000Z'),
    }])
    expect(result.hasMore).toBe(false)
  })

  it('ignores collapsed keys that are not present in current view', () => {
    const sessions = [
      makeSession('a', { sessionStatus: 'in-progress' }),
      makeSession('b', { sessionStatus: 'done' }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['status-todo']),
      'status'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['a', 'b'])
    expect(result.collapsedGroupsMeta).toEqual([])
  })

  it('preserves latest activity for collapsed project groups so expand does not reorder folders', () => {
    const sessions = [
      makeSession('new-visible', {
        workingDirectory: 'C:\\repo\\newer',
        lastMessageAt: Date.parse('2026-03-07T10:00:00.000Z'),
      }),
      makeSession('collapsed-recent', {
        workingDirectory: 'C:\\repo\\collapsed',
        lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z'),
      }),
      makeSession('old-visible', {
        workingDirectory: 'C:\\repo\\older',
        lastMessageAt: Date.parse('2026-03-04T10:00:00.000Z'),
      }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['project-C:\\repo\\collapsed']),
      'project'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['new-visible', 'old-visible'])
    expect(result.collapsedGroupsMeta).toEqual([{
      key: 'project-C:\\repo\\collapsed',
      count: 1,
      latestAt: Date.parse('2026-03-06T10:00:00.000Z'),
    }])
  })

  it('normalizes project collapse keys for trailing slashes', () => {
    const sessions = [
      makeSession('collapsed', {
        workingDirectory: 'C:\\repo\\project\\',
        lastMessageAt: Date.parse('2026-03-06T10:00:00.000Z'),
      }),
      makeSession('visible', {
        workingDirectory: 'C:\\repo\\other',
        lastMessageAt: Date.parse('2026-03-05T10:00:00.000Z'),
      }),
    ]

    const result = computeCollapsedPagination(
      sessions,
      50,
      new Set(['project-C:\\repo\\project']),
      'project'
    )

    expect(result.paginatedItems.map(s => s.id)).toEqual(['visible'])
    expect(result.collapsedGroupsMeta.map(meta => meta.key)).toEqual(['project-C:\\repo\\project'])
  })
})
