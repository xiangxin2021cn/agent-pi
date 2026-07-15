import type { BusinessModuleId, SessionBusinessContext } from '@craft-agent/shared/business-projects'

interface BusinessSessionLike {
  id: string
  lastMessageAt?: number
  businessContext?: SessionBusinessContext
}

export function sessionsForBusinessProject<T extends BusinessSessionLike>(
  sessions: Iterable<T>,
  moduleId: BusinessModuleId,
  projectId: string,
): T[] {
  return [...sessions]
    .filter((session) => session.businessContext?.module === moduleId && session.businessContext.projectId === projectId)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}
