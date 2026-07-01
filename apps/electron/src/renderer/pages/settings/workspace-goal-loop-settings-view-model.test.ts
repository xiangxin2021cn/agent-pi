import { describe, expect, it } from 'bun:test'
import {
  buildGoalLoopSettingsPayload,
  resolveGoalLoopMaxExtraReviewers,
} from './workspace-goal-loop-settings-view-model'

describe('workspace goal loop settings view model', () => {
  it('defaults learned routing to one extra reviewer for ability-first setup', () => {
    expect(resolveGoalLoopMaxExtraReviewers(undefined)).toBe(1)
    expect(resolveGoalLoopMaxExtraReviewers(0)).toBe(0)
    expect(resolveGoalLoopMaxExtraReviewers(2.8)).toBe(2)
  })

  it('preserves reviewer budget and model routing when saving one goal loop field', () => {
    expect(buildGoalLoopSettingsPayload({
      current: {
        defaultMode: 'auto_improve',
        qualityMode: 'council',
        maxExtraReviewers: 0,
        reviewerModels: {
          code_implementation_reviewer: 'local-code-reviewer',
        },
      },
      patch: {
        qualityMode: 'standard',
      },
    })).toEqual({
      defaultMode: 'auto_improve',
      qualityMode: 'standard',
      maxExtraReviewers: 0,
      reviewerModels: {
        code_implementation_reviewer: 'local-code-reviewer',
      },
    })
  })
})
