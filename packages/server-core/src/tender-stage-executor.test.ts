import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSessionRequest } from '@craft-agent/shared/agent';
import {
  isTenderStageCapacityError,
  updateTenderStageTaskBoard,
  type TenderStageBatchTaskSpec,
} from './tender-stage-executor.ts';

describe('tender stage task-board executor', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('bounds concurrency and fills the next slot only after a valid report completes', async () => {
    const fixture = createTasks(5);
    const calls: SpawnSessionRequest[] = [];
    const sessions = new Map<string, { id: string; isProcessing: boolean; sessionStatus: string }>();
    const execution = {
      spawnSession: async (_parentSessionId: string, request: SpawnSessionRequest) => {
        calls.push(request);
        const sessionId = `child-${calls.length}`;
        sessions.set(sessionId, { id: sessionId, isProcessing: true, sessionStatus: 'todo' });
        return { sessionId, name: request.name ?? sessionId, status: 'started' as const };
      },
      getSession: async (sessionId: string) => sessions.get(sessionId) ?? null,
    };

    const started = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(started.tasks.filter((task) => task.status === 'running')).toHaveLength(4);
    expect(started.tasks.filter((task) => task.status === 'pending')).toHaveLength(1);
    expect(calls).toHaveLength(4);

    const progressedTasks = fixture.tasks.map((task, index) => index === 0
      ? { ...task, validationStatus: 'complete' as const }
      : task);
    const inspected = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: progressedTasks, execution,
    });
    expect(inspected.tasks.filter((task) => task.status === 'complete')).toHaveLength(1);
    // status inspect must not auto-dispatch the freed slot
    expect(inspected.tasks.filter((task) => task.status === 'running')).toHaveLength(3);
    expect(inspected.tasks.filter((task) => task.status === 'pending')).toHaveLength(1);
    expect(calls).toHaveLength(4);

    const resumed = await updateTenderStageTaskBoard({
      action: 'resume', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: progressedTasks, execution,
    });
    expect(resumed.tasks.filter((task) => task.status === 'complete')).toHaveLength(1);
    expect(resumed.tasks.filter((task) => task.status === 'running')).toHaveLength(4);
    expect(calls).toHaveLength(5);
  });

  test('retries failed dispatch only on an explicit start action', async () => {
    const fixture = createTasks(1);
    let attempt = 0;
    const execution = {
      spawnSession: async (_parentSessionId: string, request: SpawnSessionRequest) => {
        attempt += 1;
        if (attempt === 1) throw new Error('temporary spawn failure');
        return { sessionId: 'child-retry', name: request.name ?? 'retry', status: 'started' as const };
      },
      getSession: async () => null,
    };

    const failed = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(failed.tasks[0]?.status).toBe('failed');

    const polled = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: fixture.tasks, execution,
    });
    expect(polled.tasks[0]?.status).toBe('failed');
    expect(attempt).toBe(1);

    const retried = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: fixture.tasks, execution,
    });
    expect(retried.tasks[0]?.status).toBe('running');
    expect(retried.tasks[0]?.attemptCount).toBe(2);
    expect(attempt).toBe(2);
  });

  test('keeps overflowed spawns queued instead of failing them', async () => {
    const fixture = createTasks(6);
    let calls = 0;
    const execution = {
      spawnSession: async (_parentSessionId: string, request: SpawnSessionRequest) => {
        calls += 1;
        // Simulate SessionManager handoff slots already partly occupied by other
        // children: board still has room, but spawn_session rejects further work.
        if (calls > 2) {
          throw new Error('spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.');
        }
        return { sessionId: `child-${calls}`, name: request.name ?? `child-${calls}`, status: 'started' as const };
      },
      getSession: async () => ({ id: 'x', isProcessing: true, sessionStatus: 'todo' }),
    };

    const started = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(started.tasks.filter((task) => task.status === 'running')).toHaveLength(2);
    expect(started.tasks.filter((task) => task.status === 'pending')).toHaveLength(4);
    expect(started.tasks.filter((task) => task.status === 'failed')).toHaveLength(0);
    expect(calls).toBe(3); // two successes + one capacity rejection that stops the round
    expect(isTenderStageCapacityError(new Error('spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.'))).toBe(true);

    // status inspect must not spawn; explicit resume keeps trying the remainder.
    const inspected = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(inspected.tasks.filter((task) => task.status === 'failed')).toHaveLength(0);
    expect(calls).toBe(3);

    const resumed = await updateTenderStageTaskBoard({
      action: 'resume', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(resumed.tasks.filter((task) => task.status === 'failed')).toHaveLength(0);
    expect(resumed.tasks.filter((task) => task.status === 'pending').length).toBeGreaterThan(0);
  });

  test('releases idle ghost running slots on inspect without dispatching', async () => {
    const fixture = createTasks(2);
    const sessions = new Map<string, { id: string; isProcessing: boolean; sessionStatus: string }>();
    const calls: string[] = [];
    const execution = {
      spawnSession: async (_parentSessionId: string, request: SpawnSessionRequest) => {
        calls.push(request.name ?? 'child');
        const sessionId = `child-${calls.length}`;
        sessions.set(sessionId, { id: sessionId, isProcessing: true, sessionStatus: 'todo' });
        return { sessionId, name: request.name ?? sessionId, status: 'started' as const };
      },
      getSession: async (sessionId: string) => sessions.get(sessionId) ?? null,
    };

    const started = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(started.tasks.every((task) => task.status === 'running')).toBe(true);

    for (const session of sessions.values()) {
      session.isProcessing = false;
      session.sessionStatus = 'todo';
    }

    const inspected = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(inspected.tasks.every((task) => task.status === 'pending')).toBe(true);
    expect(inspected.tasks.every((task) => !task.sessionId && task.lastSessionId)).toBe(true);
    expect(calls).toHaveLength(2);

    const resumed = await updateTenderStageTaskBoard({
      action: 'resume', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution,
    });
    expect(resumed.tasks.every((task) => task.status === 'running')).toBe(true);
    expect(calls).toHaveLength(4);
  });

  test('does not clobber an in-flight retry with a stale invalid report', async () => {
    const fixture = createTasks(1);
    const sessions = new Map<string, { id: string; isProcessing: boolean; sessionStatus: string }>();
    const execution = {
      spawnSession: async (_parentSessionId: string, request: SpawnSessionRequest) => {
        const sessionId = 'child-running';
        sessions.set(sessionId, { id: sessionId, isProcessing: true, sessionStatus: 'todo' });
        return { sessionId, name: request.name ?? sessionId, status: 'started' as const };
      },
      getSession: async (sessionId: string) => sessions.get(sessionId) ?? null,
    };

    writeFileSync(fixture.tasks[0]!.reportPath, JSON.stringify({ bad: true }));
    const invalidTasks = fixture.tasks.map((task) => ({
      ...task,
      validationStatus: 'invalid' as const,
      validationErrors: ['sections schema is invalid'],
    }));

    const failed = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution,
    });
    expect(failed.tasks[0]?.status).toBe('failed');
    expect(existsSync(fixture.tasks[0]!.reportPath)).toBe(true);

    const retried = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution,
    });
    expect(retried.tasks[0]?.status).toBe('running');
    expect(existsSync(fixture.tasks[0]!.reportPath)).toBe(false);
    expect(readdirSync(join(fixture.projectDirectory, 'orchestration', 'reports'))
      .some((name) => name.includes('.invalid.'))).toBe(true);

    const polled = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution,
    });
    expect(polled.tasks[0]?.status).toBe('running');
    expect(polled.tasks[0]?.sessionId).toBe('child-running');
  });

  function createTasks(count: number): { projectDirectory: string; tasks: TenderStageBatchTaskSpec[] } {
    root = mkdtempSync(join(tmpdir(), 'tender-stage-executor-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'n3');
    const briefDirectory = join(projectDirectory, 'orchestration', 'briefs');
    const reportDirectory = join(projectDirectory, 'orchestration', 'reports');
    mkdirSync(briefDirectory, { recursive: true });
    mkdirSync(reportDirectory, { recursive: true });
    const sourcePath = join(root, 'source.pdf');
    writeFileSync(sourcePath, 'source');
    const tasks = Array.from({ length: count }, (_, index): TenderStageBatchTaskSpec => {
      const batchId = `batch-${index + 1}`;
      const briefPath = join(briefDirectory, `${batchId}.json`);
      writeFileSync(briefPath, JSON.stringify({ batchId }));
      return {
        batchId,
        name: `Batch ${index + 1}`,
        briefPath,
        reportPath: join(reportDirectory, `${batchId}.json`),
        allowedSourcePaths: [sourcePath],
        validationStatus: 'pending',
        validationErrors: [],
      };
    });
    return { projectDirectory, tasks };
  }
});
