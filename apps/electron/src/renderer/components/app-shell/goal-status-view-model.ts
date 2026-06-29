import type { SessionGoalCriterionKind, SessionGoalMode, SessionGoalState } from '@craft-agent/shared/sessions'
import type { SessionGoalUpdate } from '@craft-agent/shared/protocol'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type GoalManualAction = {
  id: 'improve' | 'accept'
  label: string
  description: string
}

export type GoalCriterionEditDraft = {
  id?: string
  text: string
  kind: SessionGoalCriterionKind
  required: boolean
}

export type GoalEditDraft = {
  objective: string
  criteria: GoalCriterionEditDraft[]
}

export type GoalLatestAuditPreview = {
  iteration: number
  status: SessionGoalState['auditHistory'][number]['status']
  summary: string
  missingCriteria: string[]
  hiddenMissingCriteriaCount: number
  evidenceCount: number
}

const LATEST_AUDIT_MISSING_LIMIT = 2

export function getGoalBadgeValue(t: Translate, goalState: SessionGoalState): string {
  if (goalState.mode === 'off') {
    return getGoalModeLabel(t, 'off')
  }

  return getGoalStatusText(t, goalState.status, goalState.iteration, goalState.maxIterations)
}

export function getGoalStatusText(
  t: Translate,
  status: SessionGoalState['status'],
  iteration: number,
  maxIterations: number,
): string {
  switch (status) {
    case 'idle':
      return t('sessionInfo.goalIdle')
    case 'running':
      return t('sessionInfo.goalRunning', { iteration, max: maxIterations })
    case 'auditing':
      return t('sessionInfo.goalAuditing', { iteration, max: maxIterations })
    case 'improving':
      return t('sessionInfo.goalImproving', { iteration, max: maxIterations })
    case 'passed':
      return t('sessionInfo.goalPassed', { iteration, max: maxIterations })
    case 'needs_review':
      return t('sessionInfo.goalNeedsReview', { iteration, max: maxIterations })
    case 'failed':
      return t('sessionInfo.goalFailed')
    case 'cancelled':
      return t('sessionInfo.goalCancelled')
  }
}

export function getGoalLatestAuditPreview(goalState: SessionGoalState): GoalLatestAuditPreview | undefined {
  const latest = goalState.auditHistory.at(-1)
  if (!latest) return undefined

  return {
    iteration: latest.iteration,
    status: latest.status,
    summary: latest.summary,
    missingCriteria: latest.missingCriteria.slice(0, LATEST_AUDIT_MISSING_LIMIT),
    hiddenMissingCriteriaCount: Math.max(0, latest.missingCriteria.length - LATEST_AUDIT_MISSING_LIMIT),
    evidenceCount: latest.evidence.length,
  }
}

export function getGoalModeLabel(t: Translate, mode: SessionGoalMode): string {
  switch (mode) {
    case 'auto_improve':
      return t('sessionInfo.goalModeAutoImprove')
    case 'check_only':
      return t('sessionInfo.goalModeCheckOnly')
    case 'off':
      return t('sessionInfo.goalModeOff')
    case 'strict_work':
      return t('sessionInfo.goalModeAutoImprove')
  }
}

export function getGoalModeDescription(t: Translate, mode: SessionGoalMode): string {
  switch (mode) {
    case 'auto_improve':
      return t('sessionInfo.goalModeAutoImproveDesc')
    case 'check_only':
      return t('sessionInfo.goalModeCheckOnlyDesc')
    case 'off':
      return t('sessionInfo.goalModeOffDesc')
    case 'strict_work':
      return t('sessionInfo.goalModeAutoImproveDesc')
  }
}

export function getGoalManualActions(t: Translate, goalState: SessionGoalState): GoalManualAction[] {
  if (goalState.mode === 'off' || (goalState.status !== 'needs_review' && goalState.status !== 'failed')) {
    return []
  }

  return [
    {
      id: 'improve',
      label: t('sessionInfo.goalImproveAgain'),
      description: t('sessionInfo.goalImproveAgainDesc'),
    },
    {
      id: 'accept',
      label: t('sessionInfo.goalAcceptDone'),
      description: t('sessionInfo.goalAcceptDoneDesc'),
    },
  ]
}

export function createBlankGoalCriterionDraft(): GoalCriterionEditDraft {
  return {
    text: '',
    kind: 'user_constraint',
    required: true,
  }
}

export function createGoalEditDraft(goalState: SessionGoalState): GoalEditDraft {
  return {
    objective: goalState.objective.trim(),
    criteria: goalState.criteria.map(criterion => ({
      id: criterion.id,
      text: criterion.text.trim(),
      kind: criterion.kind,
      required: criterion.required,
    })),
  }
}

export function buildGoalUpdateFromDraft(draft: GoalEditDraft): SessionGoalUpdate {
  return {
    objective: draft.objective.trim(),
    criteria: draft.criteria
      .map(criterion => ({
        id: criterion.id,
        text: criterion.text.trim(),
        kind: criterion.kind,
        required: criterion.required,
      }))
      .filter(criterion => criterion.text.length > 0),
  }
}
