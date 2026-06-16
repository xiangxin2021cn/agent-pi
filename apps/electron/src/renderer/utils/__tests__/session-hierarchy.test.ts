import { describe, expect, it } from 'bun:test'
import { buildSessionHierarchy } from '../session-hierarchy'
import type { SessionMeta } from '../../atoms/sessions'

function session(overrides: Partial<SessionMeta> & { id: string }): SessionMeta {
  return {
    workspaceId: 'ws-1',
    lastMessageAt: 100,
    ...overrides,
    id: overrides.id,
  }
}

describe('buildSessionHierarchy', () => {
  it('moves child sessions under their parent and aggregates parent activity', () => {
    const hierarchy = buildSessionHierarchy([
      session({ id: 'parent', lastMessageAt: 100 }),
      session({ id: 'child-a', parentSessionId: 'parent', parentSessionKind: 'spawn', lastMessageAt: 300 }),
      session({ id: 'child-b', parentSessionId: 'parent', parentSessionKind: 'branch', lastMessageAt: 200 }),
      session({ id: 'standalone', lastMessageAt: 250 }),
    ])

    expect(hierarchy.rootItems.map(item => item.id)).toEqual(['parent', 'standalone'])
    expect(hierarchy.rootItems.find(item => item.id === 'parent')?.lastMessageAt).toBe(300)
    expect(hierarchy.childrenByParentId.get('parent')?.map(item => item.id)).toEqual(['child-a', 'child-b'])
    expect(hierarchy.descendantCountBySessionId.get('parent')).toBe(2)
    expect(hierarchy.descendantKindCountsBySessionId.get('parent')).toEqual({ branch: 1, spawn: 1 })
  })

  it('keeps children at root when the parent is not visible or missing', () => {
    const hierarchy = buildSessionHierarchy([
      session({ id: 'archived-parent', isArchived: true }),
      session({ id: 'child-of-archived', parentSessionId: 'archived-parent', parentSessionKind: 'spawn' }),
      session({ id: 'orphan', parentSessionId: 'missing', parentSessionKind: 'spawn' }),
    ])

    expect(hierarchy.rootItems.map(item => item.id)).toEqual([
      'archived-parent',
      'child-of-archived',
      'orphan',
    ])
    expect(hierarchy.childrenByParentId.size).toBe(0)
  })

  it('supports nested spawned sessions and counts all descendants', () => {
    const hierarchy = buildSessionHierarchy([
      session({ id: 'root', lastMessageAt: 100 }),
      session({ id: 'child', parentSessionId: 'root', parentSessionKind: 'spawn', lastMessageAt: 200 }),
      session({ id: 'grandchild', parentSessionId: 'child', parentSessionKind: 'spawn', lastMessageAt: 400 }),
    ])

    expect(hierarchy.rootItems.map(item => item.id)).toEqual(['root'])
    expect(hierarchy.rootItems[0].lastMessageAt).toBe(400)
    expect(hierarchy.descendantCountBySessionId.get('root')).toBe(2)
    expect(hierarchy.descendantCountBySessionId.get('child')).toBe(1)
    expect(hierarchy.descendantKindCountsBySessionId.get('root')).toEqual({ branch: 0, spawn: 2 })
  })

  it('keeps sessions visible when corrupt parent links form a cycle', () => {
    const hierarchy = buildSessionHierarchy([
      session({ id: 'a', parentSessionId: 'b', parentSessionKind: 'spawn' }),
      session({ id: 'b', parentSessionId: 'a', parentSessionKind: 'branch' }),
      session({ id: 'root' }),
    ])

    expect(hierarchy.rootItems.map(item => item.id)).toEqual(['a', 'b', 'root'])
    expect(hierarchy.childrenByParentId.size).toBe(0)
  })
})
