import { canonicalTenderStageId } from '@craft-agent/session-tools-core'

/** Stages where parent spawn_session must respect stage concurrency (not flood). */
const CONTROLLED_DISPATCH_STAGES = new Set([
  'tender-document-analysis',
  'boq-five-step-pricing',
])

/** Default max in-flight children for agent-initiated spawns (matches stage board / global handoff cap). */
const STAGE_AGENT_SPAWN_LIMIT: Record<string, number> = {
  'tender-document-analysis': 4,
  'boq-five-step-pricing': 4,
}

export type TenderSpawnDispatchSource = 'agent' | 'stage-controller'

export interface TenderParentSpawnGateInput {
  businessContext?: {
    module: string
    stageId: string
  }
  dispatchSource?: TenderSpawnDispatchSource
  /** Currently active handoffs for this parent (processing / pending report). */
  activeSpawnCount: number
  /** Optional override from the live task board maxConcurrency. */
  boardMaxConcurrency?: number
}

export interface TenderParentSpawnGateDecision {
  allowed: boolean
  reason?: string
  message?: string
  /** Effective concurrency cap applied for this decision (when relevant). */
  concurrencyLimit?: number
}

/**
 * Tender parent chat is the command surface for spawn_session.
 * Stage controller UI (下一步/恢复) is complementary fill-up + stop/resume control.
 *
 * Gate only blocks flood: agent spawns during document-analysis / BOQ must stay
 * within stage concurrency (default 4). Stage-controller dispatches are
 * already concurrency-capped by the task board and always allowed here.
 */
export function decideTenderParentSpawnGate(
  input: TenderParentSpawnGateInput,
): TenderParentSpawnGateDecision {
  if (input.businessContext?.module !== 'tender') {
    return { allowed: true }
  }
  if (input.dispatchSource === 'stage-controller') {
    return { allowed: true }
  }

  const stageId = canonicalTenderStageId(input.businessContext.stageId)
  if (!CONTROLLED_DISPATCH_STAGES.has(stageId)) {
    return { allowed: true }
  }

  const limit = Math.max(
    1,
    input.boardMaxConcurrency
      ?? STAGE_AGENT_SPAWN_LIMIT[stageId]
      ?? 4,
  )
  if (input.activeSpawnCount >= limit) {
    return {
      allowed: false,
      reason: 'tender-stage-concurrency',
      concurrencyLimit: limit,
      message:
        `spawn_session active handoff limit reached (${input.activeSpawnCount}/${limit}) `
        + `for tender stage "${stageId}". Return control and let existing children finish `
        + `(or use workbench 下一步 after a slot frees). Do not flood beyond stage concurrency.`,
    }
  }
  return { allowed: true, concurrencyLimit: limit }
}

export function isTenderControlledDispatchStage(stageId: string | undefined): boolean {
  if (!stageId?.trim()) return false
  return CONTROLLED_DISPATCH_STAGES.has(canonicalTenderStageId(stageId))
}

export function defaultTenderAgentSpawnConcurrency(stageId: string | undefined): number | undefined {
  if (!stageId?.trim()) return undefined
  const canonical = canonicalTenderStageId(stageId)
  return STAGE_AGENT_SPAWN_LIMIT[canonical]
}
