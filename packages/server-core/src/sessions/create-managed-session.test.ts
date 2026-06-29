import { describe, expect, it } from 'bun:test'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { createManagedSession } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })

  it('recovers stale improving goal state to manual review on restore', () => {
    const managed = createManagedSession({
      id: 'session_stale_goal',
      goalState: goalState({
        status: 'improving',
        iteration: 1,
      }),
    }, workspace as any)

    expect(managed.goalState?.status).toBe('needs_review')
    expect(managed.goalState?.auditHistory.at(-1)?.summary).toContain('interrupted before completion')
    expect(managed.goalState?.auditHistory.at(-1)?.evidence).toContainEqual({
      type: 'system',
      label: 'stale_goal_state',
      detail: 'improving',
    })
  })

  it('recovers stale auditing goal state to manual review on restore', () => {
    const managed = createManagedSession({
      id: 'session_stale_audit',
      goalState: goalState({
        status: 'auditing',
        iteration: 2,
      }),
    }, workspace as any)

    expect(managed.goalState?.status).toBe('needs_review')
    expect(managed.goalState?.auditHistory.at(-1)?.evidence).toContainEqual({
      type: 'system',
      label: 'stale_goal_state',
      detail: 'auditing',
    })
  })
})

function goalState(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a complete deliverable',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 3,
    criteria: [{
      id: 'crit-1',
      text: 'Complete the deliverable.',
      kind: 'deliverable',
      required: true,
    }],
    auditHistory: [],
    ...overrides,
  }
}
