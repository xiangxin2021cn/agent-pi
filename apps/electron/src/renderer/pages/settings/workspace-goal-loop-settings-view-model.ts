import type { WorkspaceSettings } from '../../../shared/types'

type GoalLoopSettings = NonNullable<WorkspaceSettings['goalLoop']>

export function resolveGoalLoopMaxExtraReviewers(value: GoalLoopSettings['maxExtraReviewers']): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(0, Math.floor(value))
}

export function buildGoalLoopSettingsPayload({
  current,
  patch,
}: {
  current: GoalLoopSettings
  patch: GoalLoopSettings
}): GoalLoopSettings {
  const reviewerModels = patch.reviewerModels ?? current.reviewerModels
  return {
    ...current,
    ...patch,
    ...(reviewerModels && Object.keys(reviewerModels).length > 0 ? { reviewerModels } : {}),
    maxExtraReviewers: resolveGoalLoopMaxExtraReviewers(patch.maxExtraReviewers ?? current.maxExtraReviewers),
  }
}
