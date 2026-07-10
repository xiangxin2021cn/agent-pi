import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import type { GoalControllerDecision } from './goal-controller'
import { enforceGoalCompletionGates } from './goal-completion-gates'

describe('goal completion gates', () => {
  it('downgrades a passing audit when orchestration or artifact gates are blocked', () => {
    const goalState = makeGoalState()
    const result = {
      iteration: 1,
      status: 'pass' as const,
      summary: 'Goal audit passed.',
      missingCriteria: [],
      evidence: [],
      createdAt: 100,
    }
    const decision: GoalControllerDecision = {
      action: 'complete',
      verifiedOutputPaths: [],
      goalState: { ...goalState, status: 'passed', auditHistory: [result] },
      result,
    }

    const gated = enforceGoalCompletionGates(decision, [
      'Orchestration audit transition blocked: phase_tasks_incomplete (chapter-1-agent).',
      'A validated document artifact is required before merge and completion.',
    ], 200)

    expect(gated.action).toBe('needs_review')
    if (gated.action !== 'needs_review') throw new Error('Expected needs_review')
    expect(gated.goalState.status).toBe('needs_review')
    expect(gated.result.status).toBe('uncertain')
    expect(gated.result.failureCategories).toContain('verification_gap')
    expect(gated.result.missingCriteria).toHaveLength(2)
    expect(gated.result.evidence).toContainEqual(expect.objectContaining({
      type: 'system',
      label: 'completion_gate_blocked',
    }))
    expect(gated.goalState.auditHistory.at(-1)).toEqual(gated.result)
    expect(gated.goalState.taskContract?.requirementLedger?.entries).toContainEqual(expect.objectContaining({
      id: 'req-del-1',
      status: 'pending',
    }))
    expect(gated.goalState.taskContract?.requirementLedger?.entries).toContainEqual(expect.objectContaining({
      id: 'req-for-1',
      status: 'pending',
    }))
    expect(gated.goalState.taskContract?.requirementLedger?.entries).toContainEqual(expect.objectContaining({
      id: 'req-con-1',
      status: 'satisfied',
    }))
  })

  it('leaves non-complete decisions unchanged', () => {
    const decision: GoalControllerDecision = {
      action: 'skip',
    }
    expect(enforceGoalCompletionGates(decision, ['blocked'], 200)).toBe(decision)
  })
})

function makeGoalState(): SessionGoalState {
  return {
    id: 'goal-1',
    mode: 'check_only',
    status: 'running',
    objective: 'Create report.',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [],
    auditHistory: [],
    taskContract: {
      originalRequest: 'Create report.',
      taskType: 'document',
      documentQualityMode: 'strict_delivery',
      deliverables: ['Final report'],
      mustPreserve: ['Use selected source only'],
      evidenceRequirements: [],
      outputFormats: ['MD'],
      acceptanceCriteria: [],
      forbiddenShortcuts: [],
      requirementLedger: {
        version: 1,
        entries: [
          { id: 'req-del-1', kind: 'deliverable', text: 'Final report', verification: 'file', status: 'satisfied', sourceRefs: [] },
          { id: 'req-con-1', kind: 'constraint', text: 'Use selected source only', verification: 'audit', status: 'satisfied', sourceRefs: [] },
          { id: 'req-for-1', kind: 'format', text: 'MD', verification: 'file', status: 'satisfied', sourceRefs: [] },
        ],
      },
    },
  }
}
