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
});
