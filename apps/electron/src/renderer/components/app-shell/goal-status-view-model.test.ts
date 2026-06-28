import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getGoalBadgeValue, getGoalManualActions, getGoalStatusText } from './goal-status-view-model'

const t = (key: string, values?: Record<string, unknown>) => {
  const suffix = values ? ` ${JSON.stringify(values)}` : ''
  return `${key}${suffix}`
}

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a complete deliverable',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 1,
    maxIterations: 3,
    criteria: [],
    auditHistory: [],
    ...overrides,
  }
}

describe('goal status view model', () => {
  it('formats goal status with iteration context', () => {
    expect(getGoalStatusText(t, 'auditing', 2, 4)).toBe('sessionInfo.goalAuditing {"iteration":2,"max":4}')
    expect(getGoalStatusText(t, 'improving', 2, 4)).toBe('sessionInfo.goalImproving {"iteration":2,"max":4}')
    expect(getGoalStatusText(t, 'needs_review', 2, 4)).toBe('sessionInfo.goalNeedsReview {"iteration":2,"max":4}')
    expect(getGoalStatusText(t, 'passed', 2, 4)).toBe('sessionInfo.goalPassed {"iteration":2,"max":4}')
  })

  it('shows the live goal phase on active goal badges', () => {
    expect(getGoalBadgeValue(t, goalState({ status: 'auditing', iteration: 1, maxIterations: 3 })))
      .toBe('sessionInfo.goalAuditing {"iteration":1,"max":3}')
    expect(getGoalBadgeValue(t, goalState({ status: 'improving', iteration: 2, maxIterations: 3 })))
      .toBe('sessionInfo.goalImproving {"iteration":2,"max":3}')
    expect(getGoalBadgeValue(t, goalState({ status: 'needs_review', iteration: 3, maxIterations: 3 })))
      .toBe('sessionInfo.goalNeedsReview {"iteration":3,"max":3}')
  })

  it('keeps off-mode badges focused on the disabled mode', () => {
    expect(getGoalBadgeValue(t, goalState({ mode: 'off', status: 'cancelled' })))
      .toBe('sessionInfo.goalModeOff')
  })

  it('shows manual goal actions only for review states', () => {
    expect(getGoalManualActions(t, goalState({ status: 'running' }))).toEqual([])
    expect(getGoalManualActions(t, goalState({ status: 'passed' }))).toEqual([])
    expect(getGoalManualActions(t, goalState({ mode: 'off', status: 'cancelled' }))).toEqual([])

    expect(getGoalManualActions(t, goalState({ status: 'needs_review' }))).toEqual([
      {
        id: 'improve',
        label: 'sessionInfo.goalImproveAgain',
        description: 'sessionInfo.goalImproveAgainDesc',
      },
      {
        id: 'accept',
        label: 'sessionInfo.goalAcceptDone',
        description: 'sessionInfo.goalAcceptDoneDesc',
      },
    ])
    expect(getGoalManualActions(t, goalState({ status: 'failed' })).map(action => action.id))
      .toEqual(['improve', 'accept'])
  })
})
