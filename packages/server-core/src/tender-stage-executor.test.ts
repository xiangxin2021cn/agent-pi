import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSessionRequest } from '@craft-agent/shared/agent';
import {
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
    const progressed = await updateTenderStageTaskBoard({
      action: 'status', projectDirectory: fixture.projectDirectory, projectId: 'n3',
      stageId: 'document-analysis', workingDirectory: root,
      tasks: progressedTasks, execution,
    });
    expect(progressed.tasks.filter((task) => task.status === 'complete')).toHaveLength(1);
    expect(progressed.tasks.filter((task) => task.status === 'running')).toHaveLength(4);
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
