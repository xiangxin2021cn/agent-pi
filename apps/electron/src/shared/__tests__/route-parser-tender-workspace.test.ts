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
});
