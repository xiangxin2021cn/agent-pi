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

  it('rejects done after goal pass while a structured child handoff is unresolved', () => {
    const goal = makeGoal('passed')
    goal.orchestration = {
      version: 1,
      phase: 'plan',
      createdAt: 1,
      updatedAt: 2,
      policy: {
        selectedSourceSlugs: [],
        forbidWorkingDirectoryDiscovery: false,
        requireStructuredHandoff: true,
        requireUserConfirmationPause: true,
        maxAutomaticRepairPasses: 2,
      },
      taskBoard: { tasks: [] },
      subAgents: [{
        sessionId: 'child-1',
        status: 'started',
        sourceSlugs: [],
        createdAt: 1,
        updatedAt: 2,
        expectedHandoff: ['report'],
      }],
    }

    expect(getAgentSessionStatusGateError(goal, 'done')).toContain('structured child handoff')
  })

  it('rejects done for a real child report even when the mode policy is false', () => {
    const goal = makeGoal('passed')
    goal.orchestration = {
      version: 1,
      phase: 'plan',
      createdAt: 1,
      updatedAt: 2,
      policy: {
        selectedSourceSlugs: [],
        forbidWorkingDirectoryDiscovery: false,
        requireStructuredHandoff: false,
        requireUserConfirmationPause: true,
        maxAutomaticRepairPasses: 2,
      },
      taskBoard: { tasks: [] },
      subAgents: [{
        sessionId: 'child-report-1',
        status: 'started',
        sourceSlugs: [],
        reportPath: 'C:/reports/child-report-1.md',
        createdAt: 1,
        updatedAt: 2,
        expectedHandoff: ['report'],
      }],
    }

    expect(getAgentSessionStatusGateError(goal, 'done')).toContain('child-report-1')
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
