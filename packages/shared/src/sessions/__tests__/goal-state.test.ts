import { describe, expect, it } from 'bun:test';
import { SESSION_PERSISTENT_FIELDS } from '../types.ts';
import { pickSessionFields } from '../utils.ts';
import type { SessionGoalState } from '../types.ts';

const goalState: SessionGoalState = {
  id: 'goal-1',
  objective: 'Create a complete deliverable',
  mode: 'check_only',
  status: 'running',
  createdAt: 1,
  updatedAt: 1,
  iteration: 0,
  maxIterations: 2,
  criteria: [],
  auditHistory: [],
};

describe('session persistence: goalState', () => {
  it('includes goalState in SESSION_PERSISTENT_FIELDS', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('goalState');
  });

  it('pickSessionFields preserves goalState when present', () => {
    const picked = pickSessionFields({
      id: 'session-1',
      workspaceRootPath: '/workspace',
      createdAt: 1,
      lastUsedAt: 2,
      goalState,
      runtimeOnly: true,
    });

    expect(picked).toEqual({
      id: 'session-1',
      workspaceRootPath: '/workspace',
      createdAt: 1,
      lastUsedAt: 2,
      goalState,
    });
  });

  it('pickSessionFields trims persisted auditHistory to recent entries without mutating source', () => {
    const sourceGoalState: SessionGoalState = {
      ...goalState,
      auditHistory: Array.from({ length: 12 }, (_, index) => ({
        iteration: index + 1,
        status: 'fail',
        summary: `Audit ${index + 1}`,
        missingCriteria: [`Missing ${index + 1}`],
        evidence: [],
        createdAt: index + 1,
      })),
    };

    const picked = pickSessionFields({
      id: 'session-1',
      workspaceRootPath: '/workspace',
      createdAt: 1,
      lastUsedAt: 2,
      goalState: sourceGoalState,
    });

    const persistedGoalState = picked.goalState as SessionGoalState;
    expect(sourceGoalState.auditHistory).toHaveLength(12);
    expect(persistedGoalState.auditHistory).toHaveLength(10);
    expect(persistedGoalState.auditHistory.map(audit => audit.iteration)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
