import type { BusinessModuleId, SessionBusinessContext } from '@craft-agent/shared/business-projects'

interface BusinessSessionLike {
  id: string
  lastMessageAt?: number
  businessContext?: SessionBusinessContext
  parentSessionId?: string
}

export function sessionsForBusinessProject<T extends BusinessSessionLike>(
  sessions: Iterable<T>,
  moduleId: BusinessModuleId,
  projectId: string,
): T[] {
  const allSessions = [...sessions]
  const projectSessionIds = new Set(
    allSessions
      .filter((session) => session.businessContext?.module === moduleId && session.businessContext.projectId === projectId)
      .map((session) => session.id),
  )

  let addedDescendant = true
  while (addedDescendant) {
    addedDescendant = false
    for (const session of allSessions) {
      if (projectSessionIds.has(session.id) || !session.parentSessionId) continue
      if (!projectSessionIds.has(session.parentSessionId)) continue
      projectSessionIds.add(session.id)
      addedDescendant = true
    }
  }

  return allSessions
    .filter((session) => projectSessionIds.has(session.id))
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}
