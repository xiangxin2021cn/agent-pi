import { describe, expect, it } from 'bun:test'
import { collectSessionThreadIds, isSessionInsideViewedThread, type SessionThreadNode } from './unread-thread'

function toSessionMap(sessions: SessionThreadNode[]): Map<string, SessionThreadNode> {
  return new Map(sessions.map(session => [session.id, session]))
}

describe('session thread unread behavior', () => {
  const sessions: SessionThreadNode[] = [
    { id: 'parent' },
    { id: 'child', parentSessionId: 'parent' },
    { id: 'grandchild', parentSessionId: 'child' },
    { id: 'sibling' },
  ]

  it('treats child-agent completion as viewed while its parent thread is open', () => {
    const sessionMap = toSessionMap(sessions)

    expect(isSessionInsideViewedThread('grandchild', 'parent', sessionMap)).toBe(true)
    expect(isSessionInsideViewedThread('grandchild', 'sibling', sessionMap)).toBe(false)
  })

  it('collects the complete child-agent subtree when a parent is marked read', () => {
    expect(new Set(collectSessionThreadIds('parent', sessions))).toEqual(
      new Set(['parent', 'child', 'grandchild']),
    )
  })

  it('does not loop forever on malformed cyclic parent metadata', () => {
    const cyclicSessions: SessionThreadNode[] = [
      { id: 'a', parentSessionId: 'b' },
      { id: 'b', parentSessionId: 'a' },
    ]

    expect(new Set(collectSessionThreadIds('a', cyclicSessions))).toEqual(new Set(['a', 'b']))
    expect(isSessionInsideViewedThread('a', 'missing', toSessionMap(cyclicSessions))).toBe(false)
  })
})
