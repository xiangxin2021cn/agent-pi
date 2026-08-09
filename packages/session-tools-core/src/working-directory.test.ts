import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from './context.ts';
import { createNodeFileSystem } from './context.ts';
import {
  requireContextWorkingDirectory,
  resolveContextWorkingDirectory,
} from './working-directory.ts';

function makeCtx(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: '/tmp/workspace',
    sourcesPath: '/tmp/workspace/sources',
    skillsPath: '/tmp/workspace/skills',
    plansFolderPath: '/tmp/workspace/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
    ...overrides,
  };
}

describe('resolveContextWorkingDirectory', () => {
  test('prefers ctx.workingDirectory', () => {
    const ctx = makeCtx({
      workingDirectory: '/from-ctx',
      getSessionInfo: () => ({
        id: 'session-1',
        name: 's',
        labels: [],
        status: 'active',
        permissionMode: 'execute',
        createdAt: 0,
        isActive: true,
        workingDirectory: '/from-info',
      }),
    });
    expect(resolveContextWorkingDirectory(ctx)).toBe('/from-ctx');
  });

  test('falls back to getSessionInfo when ctx.workingDirectory is unset', () => {
    const ctx = makeCtx({
      getSessionInfo: () => ({
        id: 'session-1',
        name: 's',
        labels: [],
        status: 'active',
        permissionMode: 'execute',
        createdAt: 0,
        isActive: true,
        workingDirectory: '/from-info',
      }),
    });
    expect(resolveContextWorkingDirectory(ctx)).toBe('/from-info');
  });
});

describe('requireContextWorkingDirectory', () => {
  test('returns ToolResult error when unresolved', () => {
    const result = requireContextWorkingDirectory(makeCtx(), 'tender_workspace');
    expect(typeof result).not.toBe('string');
    expect((result as { isError?: boolean }).isError).toBe(true);
  });
});
