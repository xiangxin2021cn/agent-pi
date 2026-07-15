import { describe, expect, test } from 'bun:test';
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser.ts';

describe('investment workspace routes', () => {
  test('round-trips independent investment navigation', () => {
    expect(parseRouteToNavigationState('investment-workspaces')).toEqual({ navigator: 'investment', details: null });
    expect(parseRouteToNavigationState('investment-workspaces/project/quarry-investment')).toEqual({
      navigator: 'investment', details: { type: 'investmentWorkspace', projectId: 'quarry-investment' },
    });
    expect(buildRouteFromNavigationState({
      navigator: 'investment', details: { type: 'investmentWorkspace', projectId: 'quarry-investment' },
    })).toBe('investment-workspaces/project/quarry-investment');
  });

  test('round-trips a session without leaving the investment project route', () => {
    const state = {
      navigator: 'investment' as const,
      details: { type: 'investmentWorkspace' as const, projectId: 'quarry-investment', sessionId: 'session-3' },
    };
    expect(buildRouteFromNavigationState(state)).toBe('investment-workspaces/project/quarry-investment/session/session-3');
    expect(parseRouteToNavigationState('investment-workspaces/project/quarry-investment/session/session-3')).toEqual(state);
  });
});
