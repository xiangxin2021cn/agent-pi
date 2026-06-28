import { describe, expect, it } from 'bun:test'
import { processEvent } from '../../processor'
import type { SessionState } from '../../types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Write a verified report',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [{
      id: 'crit-1',
      text: 'The report cites source files.',
      kind: 'evidence',
      required: true,
    }],
    auditHistory: [],
    ...overrides,
  }
}

function makeState(goal?: SessionGoalState): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      lastMessageAt: 1,
      goalState: goal,
    } as any,
    streaming: null,
  }
}

describe('goal state events', () => {
  it('marks an existing goal as auditing on goal_audit_started', () => {
    const result = processEvent(makeState(goalState()), {
      type: 'goal_audit_started',
      sessionId: 'session-1',
      goalId: 'goal-1',
      iteration: 1,
      mode: 'auto_improve',
    } as any)

    expect(result.state.session.goalState?.status).toBe('auditing')
    expect(result.state.session.goalState?.iteration).toBe(1)
  })

  it('stores goalState from goal_audit_result', () => {
    const nextGoal = goalState({ status: 'improving', iteration: 1 })

    const result = processEvent(makeState(goalState()), {
      type: 'goal_audit_result',
      sessionId: 'session-1',
      goalId: 'goal-1',
      result: {
        iteration: 1,
        status: 'uncertain',
        summary: 'Needs another pass.',
        missingCriteria: ['The report cites source files.'],
        evidence: [],
        createdAt: 2,
      },
      goalState: nextGoal,
    } as any)

    expect(result.state.session.goalState).toEqual(nextGoal)
  })

  it('stores goalState from goal_state_changed', () => {
    const nextGoal = goalState({ mode: 'off', status: 'cancelled' })

    const result = processEvent(makeState(goalState()), {
      type: 'goal_state_changed',
      sessionId: 'session-1',
      goalState: nextGoal,
    } as any)

    expect(result.state.session.goalState).toEqual(nextGoal)
  })

  it('stores terminal goal states from complete and needs-review events', () => {
    const completed = processEvent(makeState(goalState()), {
      type: 'goal_completed',
      sessionId: 'session-1',
      goalId: 'goal-1',
      goalState: goalState({ status: 'passed', iteration: 1 }),
    } as any)
    expect(completed.state.session.goalState?.status).toBe('passed')

    const needsReview = processEvent(makeState(goalState()), {
      type: 'goal_needs_review',
      sessionId: 'session-1',
      goalId: 'goal-1',
      reason: 'Manual review is required.',
      goalState: goalState({ status: 'needs_review', iteration: 2 }),
    } as any)
    expect(needsReview.state.session.goalState?.status).toBe('needs_review')
  })
})
