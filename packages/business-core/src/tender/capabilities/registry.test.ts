import { describe, expect, test } from 'bun:test';

describe('tender capability registry', () => {
  test('returns stable dependencies for each implemented stage', async () => {
    const tender = await import('../index.ts') as Record<string, unknown>;
    expect(typeof tender.getTenderCapabilityDependencies).toBe('function');

    const dependencies = tender.getTenderCapabilityDependencies as (
      capability: string,
      enabled?: string[],
    ) => string[];

    expect(dependencies('evaluation_strategy')).toEqual(['core']);
    expect(dependencies('execution_plan')).toEqual([
      'core',
      'evaluation_strategy',
      'boq_reconciliation',
    ]);
    expect(dependencies('submission_audit', [
      'evaluation_strategy',
      'boq_reconciliation',
      'submission_audit',
    ])).toEqual(['core', 'evaluation_strategy', 'boq_reconciliation']);
  });

  test('marks an envelope stale when core or upstream revisions change', async () => {
    const tender = await import('../index.ts') as Record<string, unknown>;
    expect(typeof tender.isTenderCapabilityStale).toBe('function');

    const isStale = tender.isTenderCapabilityStale as (
      envelope: Record<string, unknown>,
      coreRevision: number,
      revisions: Record<string, number>,
    ) => boolean;
    const envelope = {
      schemaVersion: 1,
      capability: 'execution_plan',
      projectId: 'n3-upgrade',
      revision: 2,
      coreRevision: 4,
      upstream: [
        { capability: 'core', revision: 4 },
        { capability: 'evaluation_strategy', revision: 2 },
        { capability: 'boq_reconciliation', revision: 3 },
      ],
      updatedAt: '2026-07-12T10:00:00.000Z',
      data: {},
    };

    expect(isStale(envelope, 4, {
      evaluation_strategy: 2,
      boq_reconciliation: 3,
    })).toBe(false);
    expect(isStale(envelope, 5, {
      evaluation_strategy: 2,
      boq_reconciliation: 3,
    })).toBe(true);
    expect(isStale(envelope, 4, {
      evaluation_strategy: 2,
      boq_reconciliation: 4,
    })).toBe(true);
  });
});
