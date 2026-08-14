import type { SessionMeta } from '@/atoms/sessions'

/** Cap permission-mode RPC fan-out after reconnect / session-list refresh. */
export const MAX_PERMISSION_RECONCILE_SESSIONS = 8

export function getSessionsToRefreshAfterStaleReconnect(
  metaMap: Map<string, SessionMeta>,
  activeSessionId: string | null,
  limit = MAX_PERMISSION_RECONCILE_SESSIONS,
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (!id || !metaMap.has(id) || seen.has(id) || ids.length >= limit) return
    seen.add(id)
    ids.push(id)
  }

  add(activeSessionId)
  for (const [sessionId, meta] of metaMap) {
    if (meta.isProcessing) add(sessionId)
  }

  return ids
}

/**
 * Sessions that need a live permission-mode RPC after a list refresh.
 *
 * Only the selected session plus currently processing sessions — never every
 * session that happens to persist a non-default mode. Workspaces with hundreds
 * of `allow-all` sessions used to fire that many parallel RPCs, which froze
 * the UI once the main process was already under memory pressure.
 */
export function getPermissionReconcileSessionIds(
  sessions: Array<{ id: string; isProcessing?: boolean }>,
  selectedSessionId?: string | null,
  limit = MAX_PERMISSION_RECONCILE_SESSIONS,
): string[] {
  const knownIds = new Set(sessions.map(session => session.id))
  const ids: string[] = []
  const seen = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (!id || !knownIds.has(id) || seen.has(id) || ids.length >= limit) return
    seen.add(id)
    ids.push(id)
  }

  add(selectedSessionId)
  for (const session of sessions) {
    if (session.isProcessing) add(session.id)
  }
  return ids
}
