import type { SessionMeta } from "@/atoms/sessions"

export interface SessionHierarchy {
  rootItems: SessionMeta[]
  childrenByParentId: Map<string, SessionMeta[]>
  parentIdByChildId: Map<string, string>
  descendantCountBySessionId: Map<string, number>
  descendantKindCountsBySessionId: Map<string, SessionThreadKindCounts>
}

export interface SessionThreadKindCounts {
  branch: number
  spawn: number
}

interface SessionHierarchyStats {
  activityAt: number
  hasUnread: boolean
  isProcessing: boolean
  descendantCount: number
  descendantKindCounts: SessionThreadKindCounts
}

function canNestSession(item: SessionMeta): boolean {
  return !item.hidden && item.isArchived !== true
}

function createDisplayItem(item: SessionMeta, stats: SessionHierarchyStats): SessionMeta {
  if (stats.descendantCount === 0) return item

  return {
    ...item,
    lastMessageAt: Math.max(item.lastMessageAt || 0, stats.activityAt),
    hasUnread: item.hasUnread || stats.hasUnread,
    isProcessing: item.isProcessing || stats.isProcessing,
  }
}

/**
 * Build a display-only parent/child tree for session lists.
 *
 * The relationship is intentionally UI-only: it does not change session execution,
 * context, persistence format, or how sessions are selected/opened.
 */
export function buildSessionHierarchy(items: SessionMeta[]): SessionHierarchy {
  const itemById = new Map(items.map(item => [item.id, item]))
  const nestableIds = new Set(items.filter(canNestSession).map(item => item.id))
  const candidateParentByChildId = new Map<string, string>()
  const sourceChildrenByParentId = new Map<string, SessionMeta[]>()
  const parentIdByChildId = new Map<string, string>()

  for (const item of items) {
    const parentId = item.parentSessionId
    if (!parentId || parentId === item.id) continue
    if (!canNestSession(item) || !nestableIds.has(parentId)) continue
    candidateParentByChildId.set(item.id, parentId)
  }

  const createsCycle = (childId: string, parentId: string): boolean => {
    const seen = new Set<string>([childId])
    let current: string | undefined = parentId
    while (current) {
      if (seen.has(current)) return true
      seen.add(current)
      current = candidateParentByChildId.get(current)
    }
    return false
  }

  for (const [childId, parentId] of candidateParentByChildId) {
    if (createsCycle(childId, parentId)) continue
    const item = itemById.get(childId)
    if (!item) continue

    parentIdByChildId.set(item.id, parentId)
    const siblings = sourceChildrenByParentId.get(parentId) ?? []
    siblings.push(item)
    sourceChildrenByParentId.set(parentId, siblings)
  }

  const statsById = new Map<string, SessionHierarchyStats>()

  const computeStats = (itemId: string, visiting = new Set<string>()): SessionHierarchyStats => {
    if (statsById.has(itemId)) return statsById.get(itemId)!
    if (visiting.has(itemId)) {
      return {
        activityAt: 0,
        hasUnread: false,
        isProcessing: false,
        descendantCount: 0,
        descendantKindCounts: { branch: 0, spawn: 0 },
      }
    }

    visiting.add(itemId)
    const item = itemById.get(itemId)
    let activityAt = item?.lastMessageAt || 0
    let hasUnread = item?.hasUnread === true
    let isProcessing = item?.isProcessing === true
    let descendantCount = 0
    const descendantKindCounts: SessionThreadKindCounts = { branch: 0, spawn: 0 }

    for (const child of sourceChildrenByParentId.get(itemId) ?? []) {
      const childStats = computeStats(child.id, visiting)
      activityAt = Math.max(activityAt, childStats.activityAt)
      hasUnread = hasUnread || childStats.hasUnread
      isProcessing = isProcessing || childStats.isProcessing
      descendantCount += 1 + childStats.descendantCount
      if (child.parentSessionKind === 'branch') descendantKindCounts.branch += 1
      if (child.parentSessionKind === 'spawn') descendantKindCounts.spawn += 1
      descendantKindCounts.branch += childStats.descendantKindCounts.branch
      descendantKindCounts.spawn += childStats.descendantKindCounts.spawn
    }

    visiting.delete(itemId)
    const stats = { activityAt, hasUnread, isProcessing, descendantCount, descendantKindCounts }
    statsById.set(itemId, stats)
    return stats
  }

  for (const item of items) computeStats(item.id)

  const displayItemById = new Map<string, SessionMeta>()
  for (const item of items) {
    displayItemById.set(item.id, createDisplayItem(item, statsById.get(item.id)!))
  }

  const childrenByParentId = new Map<string, SessionMeta[]>()
  for (const [parentId, children] of sourceChildrenByParentId) {
    childrenByParentId.set(
      parentId,
      children
        .map(child => displayItemById.get(child.id) ?? child)
        .sort((a, b) => {
          const aActivity = statsById.get(a.id)?.activityAt ?? a.lastMessageAt ?? 0
          const bActivity = statsById.get(b.id)?.activityAt ?? b.lastMessageAt ?? 0
          return bActivity - aActivity
        }),
    )
  }

  const childIds = new Set(parentIdByChildId.keys())
  const rootItems = items
    .filter(item => !childIds.has(item.id))
    .map(item => displayItemById.get(item.id) ?? item)

  const descendantCountBySessionId = new Map<string, number>()
  const descendantKindCountsBySessionId = new Map<string, SessionThreadKindCounts>()
  for (const [id, stats] of statsById) {
    if (stats.descendantCount > 0) {
      descendantCountBySessionId.set(id, stats.descendantCount)
      descendantKindCountsBySessionId.set(id, stats.descendantKindCounts)
    }
  }

  return {
    rootItems,
    childrenByParentId,
    parentIdByChildId,
    descendantCountBySessionId,
    descendantKindCountsBySessionId,
  }
}
