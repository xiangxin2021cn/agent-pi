/**
 * Session utility functions
 */

import { SESSION_PERSISTENT_FIELDS, type SessionGoalState, type SessionPersistentField } from './types.js';

export const MAX_PERSISTED_GOAL_AUDITS = 10;

/**
 * Pick persistent fields from a session-like object.
 * Used by createSessionHeader, readSessionJsonl, getSessions, getSession
 * to ensure all persistent fields are included consistently.
 *
 * @param source - Object containing session fields
 * @returns Object with only the persistent fields that exist in source
 */
export function pickSessionFields<T extends object>(
  source: T
): Partial<Record<SessionPersistentField, unknown>> {
  const result: Partial<Record<SessionPersistentField, unknown>> = {};
  for (const field of SESSION_PERSISTENT_FIELDS) {
    if (field in source && (source as Record<string, unknown>)[field] !== undefined) {
      const value = (source as Record<string, unknown>)[field];
      result[field] = field === 'goalState' ? compactGoalStateForPersistence(value) : value;
    }
  }
  return result;
}

function compactGoalStateForPersistence(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as SessionGoalState).auditHistory)) {
    return value;
  }

  const goalState = value as SessionGoalState;
  if (goalState.auditHistory.length <= MAX_PERSISTED_GOAL_AUDITS) {
    return goalState;
  }

  return {
    ...goalState,
    auditHistory: goalState.auditHistory.slice(-MAX_PERSISTED_GOAL_AUDITS),
  };
}
