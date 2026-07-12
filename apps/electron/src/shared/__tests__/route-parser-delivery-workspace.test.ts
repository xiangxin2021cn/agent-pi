import { describe, expect, test } from 'bun:test';
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser.ts';

describe('route-parser: delivery workspace routes', () => {
  test('parses the delivery workspace list and project detail routes', () => {
    expect(parseRouteToNavigationState('delivery-workspaces')).toEqual({ navigator: 'delivery', details: null });
    expect(parseRouteToNavigationState('delivery-workspaces/project/n3-delivery')).toEqual({
      navigator: 'delivery',
      details: { type: 'deliveryWorkspace', projectId: 'n3-delivery' },
    });
  });

  test('builds a stable project detail route', () => {
    expect(buildRouteFromNavigationState({
      navigator: 'delivery',
      details: { type: 'deliveryWorkspace', projectId: 'n3-delivery' },
    })).toBe('delivery-workspaces/project/n3-delivery');
  });
});
