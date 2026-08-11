import { describe, expect, test } from 'bun:test';
import { hasLegacyTenderStageKeys, migrateTenderStageState } from './tender-orchestration-migrate.ts';

describe('migrateTenderStageState', () => {
  test('folds planning + submission into planning-and-submission as complete only when both complete', () => {
    const migrated = migrateTenderStageState({
      schemaVersion: 1,
      projectId: 'n3',
      updatedAt: '2026-08-01T00:00:00.000Z',
      stages: {
        planning: {
          stageId: 'planning',
          status: 'complete',
          updatedAt: '2026-08-01T01:00:00.000Z',
          completedAt: '2026-08-01T01:00:00.000Z',
        },
        submission: {
          stageId: 'submission',
          status: 'running',
          updatedAt: '2026-08-01T02:00:00.000Z',
        },
      },
    });

    expect(migrated.migratedFromLegacy).toBe(true);
    expect(migrated.stages['planning-and-submission']?.status).toBe('running');
    expect(migrated.stages.planning?.status).toBe('complete');
    expect(hasLegacyTenderStageKeys(migrated)).toBe(true);
  });

  test('marks planning-and-submission complete when every legacy contributor is complete', () => {
    const migrated = migrateTenderStageState({
      schemaVersion: 1,
      projectId: 'n3',
      updatedAt: '2026-08-01T00:00:00.000Z',
      stages: {
        planning: { status: 'complete', updatedAt: '2026-08-01T01:00:00.000Z', completedAt: '2026-08-01T01:00:00.000Z' },
        submission: { status: 'complete', updatedAt: '2026-08-01T02:00:00.000Z', completedAt: '2026-08-01T02:00:00.000Z' },
      },
    });
    expect(migrated.stages['planning-and-submission']?.status).toBe('complete');
    expect(migrated.stages['planning-and-submission']?.completedAt).toBe('2026-08-01T02:00:00.000Z');
  });

  test('leaves already-canonical state unchanged without migrated flag', () => {
    const migrated = migrateTenderStageState({
      schemaVersion: 1,
      projectId: 'n3',
      updatedAt: '2026-08-01T00:00:00.000Z',
      stages: {
        'project-setup': { status: 'complete', updatedAt: '2026-08-01T00:00:00.000Z' },
      },
    });
    expect(migrated.migratedFromLegacy).toBeUndefined();
    expect(Object.keys(migrated.stages)).toEqual(['project-setup']);
  });
});
