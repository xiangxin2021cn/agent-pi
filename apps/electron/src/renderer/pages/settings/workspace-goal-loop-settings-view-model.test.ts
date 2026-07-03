import { describe, expect, it } from 'bun:test'
import {
  buildGoalLoopSettingsPayload,
  resolveDocumentMaxAutoVisuals,
  resolveDocumentVisualMode,
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
      documentVisualMode: 'standard',
      maxAutoVisuals: 5,
      reviewerModels: {
        code_implementation_reviewer: 'local-code-reviewer',
      },
    })
  })

  it('normalizes document visual mode and max auto visuals', () => {
    expect(resolveDocumentVisualMode(undefined)).toBe('standard')
    expect(resolveDocumentVisualMode('fast')).toBe('fast')
    expect(resolveDocumentVisualMode('professional')).toBe('professional')
    expect(resolveDocumentVisualMode('unknown')).toBe('standard')
    expect(resolveDocumentMaxAutoVisuals(undefined)).toBe(5)
    expect(resolveDocumentMaxAutoVisuals(2.8)).toBe(2)
    expect(resolveDocumentMaxAutoVisuals(-1)).toBe(0)
    expect(resolveDocumentMaxAutoVisuals(99)).toBe(12)
  })

  it('preserves document visual settings when saving another goal loop field', () => {
    expect(buildGoalLoopSettingsPayload({
      current: {
        defaultMode: 'auto_improve',
        qualityMode: 'council',
        documentVisualMode: 'professional',
        maxAutoVisuals: 8,
      },
      patch: {
        qualityMode: 'standard',
      },
    })).toEqual({
      defaultMode: 'auto_improve',
      qualityMode: 'standard',
      maxExtraReviewers: 1,
      documentVisualMode: 'professional',
      maxAutoVisuals: 8,
    })
  })
})
