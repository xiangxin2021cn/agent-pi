export interface SessionThreadNode {
  id: string
  parentSessionId?: string
}

export function isSessionInsideViewedThread(
  sessionId: string,
  viewedSessionId: string | undefined,
  sessions: ReadonlyMap<string, SessionThreadNode>,
): boolean {
  if (!viewedSessionId) return false

  const visited = new Set<string>()
  let currentId: string | undefined = sessionId

  while (currentId && !visited.has(currentId)) {
    if (currentId === viewedSessionId) return true
    visited.add(currentId)
    currentId = sessions.get(currentId)?.parentSessionId
  }

  return false
}

export function collectSessionThreadIds(
  rootSessionId: string,
  sessions: Iterable<SessionThreadNode>,
): string[] {
  const childrenByParentId = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentSessionId || session.id === session.parentSessionId) continue
    const childIds = childrenByParentId.get(session.parentSessionId) ?? []
    childIds.push(session.id)
    childrenByParentId.set(session.parentSessionId, childIds)
  }

  const result: string[] = []
  const visited = new Set<string>()
  const pending = [rootSessionId]

  while (pending.length > 0) {
    const sessionId = pending.pop()!
    if (visited.has(sessionId)) continue
    visited.add(sessionId)
    result.push(sessionId)
    pending.push(...(childrenByParentId.get(sessionId) ?? []))
  }

  return result
}
