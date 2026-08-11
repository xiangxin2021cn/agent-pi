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

  test('start binds parent but does not flood pending tasks', async () => {
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
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    expect(started.parentSessionId).toBe('parent-1');
    expect(started.tasks.filter((task) => task.status === 'running')).toHaveLength(0);
    expect(started.tasks.filter((task) => task.status === 'pending')).toHaveLength(5);
    expect(calls).toHaveLength(0);
  });

  test('advance fills up to maxConcurrency=2', async () => {
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

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    const advanced = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    expect(advanced.tasks.filter((task) => task.status === 'running')).toHaveLength(2);
    expect(advanced.tasks.filter((task) => task.status === 'pending')).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.dispatchSource === 'stage-controller')).toBe(true);

    const progressedTasks = fixture.tasks.map((task, index) => index === 0
      ? { ...task, validationStatus: 'complete' as const }
      : task);
    const inspected = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: progressedTasks, execution, maxConcurrency: 2,
    });
    expect(inspected.tasks.filter((task) => task.status === 'complete')).toHaveLength(1);
    expect(inspected.tasks.filter((task) => task.status === 'running')).toHaveLength(1);
    expect(calls).toHaveLength(2);

    const resumed = await updateTenderStageTaskBoard({
      action: 'resume', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: progressedTasks, execution, maxConcurrency: 2,
    });
    expect(resumed.tasks.filter((task) => task.status === 'complete')).toHaveLength(1);
    expect(resumed.tasks.filter((task) => task.status === 'running')).toHaveLength(2);
    expect(calls).toHaveLength(3);
  });

  test('set_dispatch false blocks advance from spawning', async () => {
    const fixture = createTasks(3);
    let calls = 0;
    const execution = {
      spawnSession: async () => {
        calls += 1;
        return { sessionId: `child-${calls}`, name: 'child', status: 'started' as const };
      },
      getSession: async () => ({ id: 'x', isProcessing: true, sessionStatus: 'todo' }),
    };

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    const stopped = await updateTenderStageTaskBoard({
      action: 'set_dispatch', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2, dispatchEnabled: false,
    });
    expect(stopped.dispatchEnabled).toBe(false);

    const advanced = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    expect(advanced.tasks.filter((task) => task.status === 'running')).toHaveLength(0);
    expect(calls).toBe(0);
  });

  test('retries failed dispatch via start reset then advance', async () => {
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

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 1,
    });
    const failed = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 1,
    });
    expect(failed.tasks[0]?.status).toBe('failed');

    const reset = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 1,
    });
    expect(reset.tasks[0]?.status).toBe('pending');
    expect(attempt).toBe(1);

    const retried = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 1,
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
        if (calls > 2) {
          throw new Error('spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.');
        }
        return { sessionId: `child-${calls}`, name: request.name ?? `child-${calls}`, status: 'started' as const };
      },
      getSession: async () => ({ id: 'x', isProcessing: true, sessionStatus: 'todo' }),
    };

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 4,
    });
    const advanced = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 4,
    });
    expect(advanced.tasks.filter((task) => task.status === 'running')).toHaveLength(2);
    expect(advanced.tasks.filter((task) => task.status === 'pending')).toHaveLength(4);
    expect(advanced.tasks.filter((task) => task.status === 'failed')).toHaveLength(0);
    expect(calls).toBe(3);
    expect(isTenderStageCapacityError(new Error('spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.'))).toBe(true);
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

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    const started = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    expect(started.tasks.every((task) => task.status === 'running')).toBe(true);

    for (const session of sessions.values()) {
      session.isProcessing = false;
      session.sessionStatus = 'todo';
    }

    const inspected = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
    });
    expect(inspected.tasks.every((task) => task.status === 'pending')).toBe(true);
    expect(inspected.tasks.every((task) => !task.sessionId && task.lastSessionId)).toBe(true);
    expect(calls).toHaveLength(2);

    const resumed = await updateTenderStageTaskBoard({
      action: 'resume', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, execution, maxConcurrency: 2,
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
      tasks: invalidTasks, execution, maxConcurrency: 1,
    });
    expect(failed.tasks[0]?.status).toBe('failed');
    expect(existsSync(fixture.tasks[0]!.reportPath)).toBe(true);

    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution, maxConcurrency: 1,
    });
    const retried = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution, maxConcurrency: 1,
    });
    expect(retried.tasks[0]?.status).toBe('running');
    expect(existsSync(fixture.tasks[0]!.reportPath)).toBe(false);
    expect(readdirSync(join(fixture.projectDirectory, 'orchestration', 'reports'))
      .some((name) => name.includes('.invalid.'))).toBe(true);

    const polled = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: invalidTasks, execution, maxConcurrency: 1,
    });
    expect(polled.tasks[0]?.status).toBe('running');
    expect(polled.tasks[0]?.sessionId).toBe('child-running');
  });

  test('bindTenderStageTaskToSpawnedSession aligns agent spawn with task board', async () => {
    const { bindTenderStageTaskToSpawnedSession } = await import('./tender-stage-executor.ts');
    const fixture = createTasks(1);
    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, maxConcurrency: 2,
    });
    const bound = bindTenderStageTaskToSpawnedSession({
      workingDirectory: root,
      projectId: 'n3',
      stageId: 'document-analysis',
      parentSessionId: 'parent-1',
      childSessionId: 'agent-spawned-1',
      reportPath: fixture.tasks[0]!.reportPath,
      briefPath: fixture.tasks[0]!.briefPath,
      name: 'Agent Batch 1',
    });
    expect(bound).toBe(true);
    const board = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: fixture.tasks, maxConcurrency: 2,
    });
    expect(board.tasks[0]?.status).toBe('running');
    expect(board.tasks[0]?.sessionId).toBe('agent-spawned-1');
  });

  test('retryBatchIds re-queues only selected failed tasks then advance can dispatch', async () => {
    const fixture = createTasks(3);
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

    // Seed a board with two failed tasks (invalid reports) and one pending.
    const seeded = await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: fixture.tasks, maxConcurrency: 1,
    });
    writeFileSync(join(fixture.projectDirectory, 'orchestration', 'task-boards', 'document-analysis.json'), JSON.stringify({
      ...seeded,
      tasks: seeded.tasks.map((task, index) => (
        index < 2
          ? {
              ...task,
              status: 'failed',
              error: 'sections[0].sourceRefs must be non-empty',
            }
          : task
      )),
    }));
    writeFileSync(fixture.tasks[0]!.reportPath, JSON.stringify({ bad: true }));
    writeFileSync(fixture.tasks[1]!.reportPath, JSON.stringify({ bad: true }));

    const failedSpecs = fixture.tasks.map((task, index) => (
      index < 2
        ? { ...task, validationStatus: 'invalid' as const, validationErrors: ['bad sourceRefs'] }
        : task
    ));
    const retried = await updateTenderStageTaskBoard({
      action: 'advance', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: failedSpecs, execution, maxConcurrency: 1,
      retryBatchIds: [fixture.tasks[0]!.batchId],
    });
    expect(retried.tasks[0]?.status).toBe('running');
    expect(retried.tasks[1]?.status).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.reportPath).toBe(fixture.tasks[0]!.reportPath);
  });

  test('parent barrier returns markdown and process artifacts for completed batches', async () => {
    const { resolveTenderStageParentBarrier } = await import('./tender-stage-executor.ts');
    const fixture = createTasks(1);
    const markdownPath = fixture.tasks[0]!.markdownPath!;
    writeFileSync(fixture.tasks[0]!.reportPath, JSON.stringify({ ok: true }));
    writeFileSync(markdownPath, '# Customer analysis\n\nReadable workpaper.\n');
    await updateTenderStageTaskBoard({
      action: 'start', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root, parentSessionId: 'parent-1',
      tasks: [{ ...fixture.tasks[0]!, validationStatus: 'complete' }], maxConcurrency: 2,
    });

    const barrier = resolveTenderStageParentBarrier({
      workingDirectory: root,
      parentSessionId: 'parent-1',
      businessContext: { module: 'tender', projectId: 'n3', stageId: 'document-analysis' },
    });
    expect(barrier.action).toBe('resume');
    expect(barrier.reportPaths).toContain(fixture.tasks[0]!.reportPath);
    expect(barrier.markdownPaths).toContain(markdownPath);
    expect(barrier.handoffArtifactPaths).toEqual(expect.arrayContaining([
      fixture.tasks[0]!.reportPath,
      markdownPath,
      fixture.tasks[0]!.briefPath,
    ]));
  });

  function createTasks(count: number): { projectDirectory: string; tasks: TenderStageBatchTaskSpec[] } {
    root = mkdtempSync(join(tmpdir(), 'tender-stage-executor-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'n3');
    const briefDirectory = join(projectDirectory, 'orchestration', 'briefs');
    const reportDirectory = join(projectDirectory, 'orchestration', 'reports');
    const markdownDirectory = join(root, 'Agent Pi Outputs', 'n3', 'document-analysis');
    mkdirSync(briefDirectory, { recursive: true });
    mkdirSync(reportDirectory, { recursive: true });
    mkdirSync(markdownDirectory, { recursive: true });
    const sourcePath = join(root, 'source.pdf');
    writeFileSync(sourcePath, 'source');
    const tasks = Array.from({ length: count }, (_, index): TenderStageBatchTaskSpec => {
      const batchId = `batch-${index + 1}`;
      const markdownPath = join(markdownDirectory, `${batchId}.md`);
      const briefPath = join(briefDirectory, `${batchId}.json`);
      writeFileSync(briefPath, JSON.stringify({ batchId, markdownPath }));
      return {
        batchId,
        name: `Batch ${index + 1}`,
        briefPath,
        reportPath: join(reportDirectory, `${batchId}.json`),
        markdownPath,
        allowedSourcePaths: [sourcePath],
        validationStatus: 'pending',
        validationErrors: [],
      };
    });
    return { projectDirectory, tasks };
  }
});
