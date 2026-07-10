import type { SessionGoalFailureCategory, SessionTaskContract } from '@craft-agent/shared/sessions'
import type { GoalControllerDecision } from './goal-controller'

export function enforceGoalCompletionGates(
  decision: GoalControllerDecision,
  blockingReasons: string[],
  now = Date.now(),
): GoalControllerDecision {
  const reasons = [...new Set(blockingReasons.map(reason => reason.trim()).filter(Boolean))]
  if (decision.action !== 'complete' || reasons.length === 0) return decision

  const failureCategories = uniqueFailureCategories([
    ...(decision.result.failureCategories ?? []),
    'verification_gap',
  ])
  const result = {
    ...decision.result,
    status: 'uncertain' as const,
    summary: `Goal audit passed, but completion gates require review: ${reasons.join(' ')}`,
    missingCriteria: [...new Set([...decision.result.missingCriteria, ...reasons])],
    failureCategories,
    evidence: [
      ...decision.result.evidence,
      {
        type: 'system' as const,
        label: 'completion_gate_blocked',
        detail: reasons.join(' | '),
      },
    ],
  }
  const auditHistory = decision.goalState.auditHistory.length > 0
    ? [...decision.goalState.auditHistory.slice(0, -1), result]
    : [result]
  const goalState = {
    ...decision.goalState,
    taskContract: reasons.some(reason => /artifact|formal output/i.test(reason))
      ? reopenCompletionRequirements(decision.goalState.taskContract)
      : decision.goalState.taskContract,
    status: 'needs_review' as const,
    updatedAt: now,
    auditHistory,
  }

  return {
    action: 'needs_review',
    goalState,
    result,
    reason: reasons.join(' '),
  }
}

function reopenCompletionRequirements(taskContract: SessionTaskContract | undefined): SessionTaskContract | undefined {
  const ledger = taskContract?.requirementLedger
  if (!taskContract || !ledger) return taskContract
  const completionKinds = new Set(['deliverable', 'format', 'acceptance'])
  return {
    ...taskContract,
    requirementLedger: {
      ...ledger,
      entries: ledger.entries.map(entry => (
        entry.status === 'satisfied' && completionKinds.has(entry.kind)
          ? { ...entry, status: 'pending' as const }
          : entry
      )),
    },
  }
}

function uniqueFailureCategories(categories: SessionGoalFailureCategory[]): SessionGoalFailureCategory[] {
  return [...new Set(categories)]
}
