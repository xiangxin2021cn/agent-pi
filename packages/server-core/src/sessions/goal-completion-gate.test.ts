import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { getAgentSessionStatusGateError } from './goal-completion-gate'

describe('agent session status goal gate', () => {
  it('rejects done while the goal has not passed', () => {
    expect(getAgentSessionStatusGateError(makeGoal('needs_review'), 'done')).toContain('Goal has not passed')
    expect(getAgentSessionStatusGateError(makeGoal('improving'), 'done')).toContain('Goal has not passed')
  })

  it('allows done after the goal passed and allows non-terminal status changes', () => {
    expect(getAgentSessionStatusGateError(makeGoal('passed'), 'done')).toBeUndefined()
    expect(getAgentSessionStatusGateError(makeGoal('needs_review'), 'in_progress')).toBeUndefined()
    expect(getAgentSessionStatusGateError(undefined, 'done')).toBeUndefined()
  })
})

function makeGoal(status: SessionGoalState['status']): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a verified report.',
    mode: 'auto_improve',
    status,
    createdAt: 1,
    updatedAt: 1,
    iteration: 1,
    maxIterations: 2,
    criteria: [],
    auditHistory: [],
  }
}
