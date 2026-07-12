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
});
