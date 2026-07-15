import { describe, expect, test } from 'bun:test';
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser.ts';

describe('route-parser: tender workspace routes', () => {
  test('parses the tender workspace list and project detail routes', () => {
    expect(parseRouteToNavigationState('tender-workspaces')).toEqual({ navigator: 'tender', details: null });
    expect(parseRouteToNavigationState('tender-workspaces/project/n3-upgrade')).toEqual({
      navigator: 'tender',
      details: { type: 'tenderWorkspace', projectId: 'n3-upgrade' },
    });
  });

  test('builds a stable project detail route', () => {
    expect(buildRouteFromNavigationState({
      navigator: 'tender',
      details: { type: 'tenderWorkspace', projectId: 'n3-upgrade' },
    })).toBe('tender-workspaces/project/n3-upgrade');
  });

  test('round-trips a session without leaving the tender project route', () => {
    const state = {
      navigator: 'tender' as const,
      details: { type: 'tenderWorkspace' as const, projectId: 'n3-upgrade', sessionId: 'session-1' },
    };
    expect(buildRouteFromNavigationState(state)).toBe('tender-workspaces/project/n3-upgrade/session/session-1');
    expect(parseRouteToNavigationState('tender-workspaces/project/n3-upgrade/session/session-1')).toEqual(state);
  });
});
