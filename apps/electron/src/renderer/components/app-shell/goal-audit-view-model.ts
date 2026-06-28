import type {
  SessionGoalAuditEvidence,
  SessionGoalAuditResult,
  SessionGoalState,
} from '@craft-agent/shared/sessions'

const DEFAULT_AUDIT_LIMIT = 3
const MISSING_CRITERIA_LIMIT = 3
const EVIDENCE_LIMIT = 4

export interface GoalAuditViewModel {
  iteration: number
  status: SessionGoalAuditResult['status']
  summary: string
  missingCriteria: string[]
  hiddenMissingCriteriaCount: number
  evidence: SessionGoalAuditEvidence[]
  hiddenEvidenceCount: number
  createdAt: number
}

export function getGoalAuditViewModels(
  goalState: SessionGoalState | undefined,
  limit = DEFAULT_AUDIT_LIMIT,
): GoalAuditViewModel[] {
  if (!goalState?.auditHistory.length) return []

  return goalState.auditHistory
    .slice(-limit)
    .reverse()
    .map(result => ({
      iteration: result.iteration,
      status: result.status,
      summary: result.summary,
      missingCriteria: result.missingCriteria.slice(0, MISSING_CRITERIA_LIMIT),
      hiddenMissingCriteriaCount: Math.max(0, result.missingCriteria.length - MISSING_CRITERIA_LIMIT),
      evidence: result.evidence.slice(0, EVIDENCE_LIMIT),
      hiddenEvidenceCount: Math.max(0, result.evidence.length - EVIDENCE_LIMIT),
      createdAt: result.createdAt,
    }))
}
