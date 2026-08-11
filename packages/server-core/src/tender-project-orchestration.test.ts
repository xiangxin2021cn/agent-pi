import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindProjectParentSession,
  readProjectOrchestration,
  resolveOrElectProjectParent,
} from './tender-project-orchestration.ts';

describe('tender project orchestration pointer', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('bind writes parent pointer', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    const bound = bindProjectParentSession(projectDirectory, '573', 'parent-a');
    expect(bound.parentSessionId).toBe('parent-a');
    expect(readProjectOrchestration(projectDirectory, '573').parentSessionId).toBe('parent-a');
  });

  test('elects later-stage parent when no pointer', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    const boards = join(projectDirectory, 'orchestration', 'task-boards');
    mkdirSync(boards, { recursive: true });
    writeFileSync(join(boards, 'tender-document-analysis.json'), JSON.stringify({
      parentSessionId: 'parent-a',
      tasks: [],
    }));
    writeFileSync(join(boards, 'boq-five-step-pricing.json'), JSON.stringify({
      parentSessionId: 'parent-b',
      tasks: [],
    }));

    const result = resolveOrElectProjectParent({
      projectDirectory,
      projectId: '573',
      candidateSessionIds: ['parent-a', 'parent-b'],
    });
    expect(result.elected).toBe(true);
    expect(result.parentSessionId).toBe('parent-b');
    expect(result.legacyParentSessionIds).toEqual(['parent-a']);
    expect(readProjectOrchestration(projectDirectory, '573').parentSessionId).toBe('parent-b');
  });

  test('existing pointer wins over board candidates', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    bindProjectParentSession(projectDirectory, '573', 'parent-canonical');
    const boards = join(projectDirectory, 'orchestration', 'task-boards');
    mkdirSync(boards, { recursive: true });
    writeFileSync(join(boards, 'tender-document-analysis.json'), JSON.stringify({
      parentSessionId: 'parent-other',
      tasks: [],
    }));

    const result = resolveOrElectProjectParent({
      projectDirectory,
      projectId: '573',
      candidateSessionIds: ['parent-other'],
    });
    expect(result.elected).toBe(false);
    expect(result.healedStalePointer).toBe(false);
    expect(result.parentSessionId).toBe('parent-canonical');
  });

  test('dead pointer heals to a live sidebar/root candidate', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    bindProjectParentSession(projectDirectory, '573', '260810-keen-meteor');
    const boards = join(projectDirectory, 'orchestration', 'task-boards');
    mkdirSync(boards, { recursive: true });
    writeFileSync(join(boards, 'tender-document-analysis.json'), JSON.stringify({
      parentSessionId: '260810-keen-meteor',
      tasks: [],
    }));

    const alive = new Set(['todo-parent-live']);
    const result = resolveOrElectProjectParent({
      projectDirectory,
      projectId: '573',
      candidateSessionIds: ['todo-parent-live'],
      isSessionAlive: (sessionId) => alive.has(sessionId),
    });
    expect(result.elected).toBe(true);
    expect(result.healedStalePointer).toBe(true);
    expect(result.parentSessionId).toBe('todo-parent-live');
    expect(result.legacyParentSessionIds).toContain('260810-keen-meteor');
    expect(readProjectOrchestration(projectDirectory, '573').parentSessionId).toBe('todo-parent-live');
  });

  test('dead pointer with no live candidates is cleared', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    bindProjectParentSession(projectDirectory, '573', 'deleted-parent');

    const result = resolveOrElectProjectParent({
      projectDirectory,
      projectId: '573',
      candidateSessionIds: ['deleted-parent'],
      isSessionAlive: () => false,
    });
    expect(result.parentSessionId).toBeUndefined();
    expect(result.healedStalePointer).toBe(true);
    expect(result.legacyParentSessionIds).toContain('deleted-parent');
    expect(readProjectOrchestration(projectDirectory, '573').parentSessionId).toBeUndefined();
  });

  test('rebind records previous parent as legacy', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-project-orch-'));
    const projectDirectory = join(root, 'business');
    bindProjectParentSession(projectDirectory, '573', 'parent-old');
    const next = bindProjectParentSession(projectDirectory, '573', 'parent-new');
    expect(next.parentSessionId).toBe('parent-new');
    expect(next.legacyParentSessionIds).toEqual(['parent-old']);
  });
});
