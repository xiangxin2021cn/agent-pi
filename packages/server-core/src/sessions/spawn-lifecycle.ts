export const DEFAULT_SPAWN_ACTIVITY_TIMEOUT_MS = 15 * 60 * 1000

export interface ResolveSpawnActivityStateInput {
  now: number
  lastActivityAt?: number
  staleAfterMs: number
  isProcessing: boolean
  queueLength: number
  reportReady: boolean
  failedLifecycle: boolean
  hasReportPath: boolean
  fallbackLifecycleStatus?: 'started' | 'running' | 'handoff_received' | 'handoff_ready' | 'completed' | 'needs_review' | 'failed' | 'unknown'
}

export interface SpawnActivityState {
  lifecycleStatus: 'started' | 'running' | 'handoff_received' | 'handoff_ready' | 'completed' | 'needs_review' | 'failed' | 'stale' | 'unknown'
  handoffStatus: 'pending' | 'ready' | 'missing' | 'failed'
  isStale: boolean
  idleMs?: number
}

export interface SpawnReportReadinessInput {
  reportExists: boolean
  reportSize?: number
  isProcessing: boolean
  queueLength: number
}

export interface ParentSpawnHandoffStatus {
  sessionId: string
  handoffStatus: 'not_applicable' | 'pending' | 'ready' | 'missing' | 'failed'
}

export interface ParentSpawnHandoffBarrierDecision {
  action: 'none' | 'wait' | 'resume' | 'review'
  pendingSessionIds: string[]
  reviewSessionIds: string[]
}

export function isSpawnReportReady(input: SpawnReportReadinessInput): boolean {
  return input.reportExists
    && (input.reportSize ?? 0) > 0
    && !input.isProcessing
    && input.queueLength === 0
}

export function resolveParentSpawnHandoffBarrier(input: {
  requireStructuredHandoff: boolean
  statuses: readonly ParentSpawnHandoffStatus[]
}): ParentSpawnHandoffBarrierDecision {
  if (!input.requireStructuredHandoff || input.statuses.length === 0) {
    return { action: 'none', pendingSessionIds: [], reviewSessionIds: [] }
  }

  const reviewSessionIds = input.statuses
    .filter(status => status.handoffStatus === 'failed' || status.handoffStatus === 'missing')
    .map(status => status.sessionId)
  const pendingSessionIds = input.statuses
    .filter(status => status.handoffStatus !== 'ready' && !reviewSessionIds.includes(status.sessionId))
    .map(status => status.sessionId)

  if (reviewSessionIds.length > 0) {
    return { action: 'review', pendingSessionIds, reviewSessionIds }
  }
  if (pendingSessionIds.length > 0) {
    return { action: 'wait', pendingSessionIds, reviewSessionIds: [] }
  }
  return { action: 'resume', pendingSessionIds: [], reviewSessionIds: [] }
}

export function resolveSpawnActivityState(input: ResolveSpawnActivityStateInput): SpawnActivityState {
  const idleMs = input.lastActivityAt === undefined
    ? undefined
    : Math.max(0, input.now - input.lastActivityAt)
  const active = input.isProcessing
    || input.queueLength > 0
    || input.fallbackLifecycleStatus === 'started'
    || input.fallbackLifecycleStatus === 'running'
    || input.fallbackLifecycleStatus === 'handoff_received'
  const isStale = !input.reportReady
    && !input.isProcessing
    && input.queueLength === 0
    && active
    && idleMs !== undefined
    && idleMs > input.staleAfterMs

  if (input.reportReady) {
    return { lifecycleStatus: 'handoff_ready', handoffStatus: 'ready', isStale: false, idleMs }
  }
  if (input.failedLifecycle || isStale) {
    return {
      lifecycleStatus: isStale ? 'stale' : 'failed',
      handoffStatus: 'failed',
      isStale,
      idleMs,
    }
  }
  if (active) {
    return {
      lifecycleStatus: input.isProcessing ? 'running' : input.fallbackLifecycleStatus ?? 'started',
      handoffStatus: 'pending',
      isStale: false,
      idleMs,
    }
  }

  return {
    lifecycleStatus: input.fallbackLifecycleStatus ?? 'unknown',
    handoffStatus: input.hasReportPath ? 'missing' : 'pending',
    isStale: false,
    idleMs,
  }
}

export function getSpawnActivityTimeoutMs(rawValue: string | undefined): number {
  if (!rawValue?.trim()) return DEFAULT_SPAWN_ACTIVITY_TIMEOUT_MS
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed >= 60_000
    ? Math.floor(parsed)
    : DEFAULT_SPAWN_ACTIVITY_TIMEOUT_MS
}
