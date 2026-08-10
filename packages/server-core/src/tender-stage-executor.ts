import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SpawnSessionRequest, SpawnSessionResult } from '@craft-agent/shared/agent';

export type TenderStageTaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'blocked';

/** Capacity / backpressure signals — keep the task queued, do not mark failed. */
export function isTenderStageCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /active handoff limit reached/i.test(message)
    || /spawn_session blocked by memory guard/i.test(message)
    || /Return control and let the runtime monitor existing handoffs/i.test(message);
}

export interface TenderStageBatchTaskSpec {
  batchId: string;
  briefPath: string;
  reportPath: string;
  allowedSourcePaths: string[];
  validationStatus: 'pending' | 'complete' | 'invalid';
  validationErrors: string[];
  name: string;
}

export interface TenderStageTaskRecord {
  batchId: string;
  name: string;
  status: TenderStageTaskStatus;
  briefPath: string;
  reportPath: string;
  allowedSourcePaths: string[];
  sessionId?: string;
  /** Previous child session kept for left-panel linkage after an idle release. */
  lastSessionId?: string;
  attemptCount: number;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  error?: string;
  /** Live session mirror for panel ↔ sidebar linkage (refreshed on inspect/resume). */
  linkedIsProcessing?: boolean;
  linkedSessionStatus?: string;
}

export interface TenderStageTaskBoard {
  schemaVersion: 1;
  projectId: string;
  stageId: string;
  parentSessionId?: string;
  maxConcurrency: number;
  updatedAt: string;
  tasks: TenderStageTaskRecord[];
  taskBoardPath: string;
}

export interface TenderStageParentBarrier {
  action: 'none' | 'wait' | 'resume' | 'review';
  pendingSessionIds: string[];
  reviewSessionIds: string[];
  reportPaths: string[];
  taskBoardPath?: string;
}

export interface TenderStageExecutionRuntime {
  spawnSession(parentSessionId: string, request: SpawnSessionRequest): Promise<SpawnSessionResult>;
  getSession(sessionId: string): Promise<{
    id: string;
    isProcessing: boolean;
    sessionStatus?: string;
    goalState?: { status: string };
  } | null>;
}

export interface UpdateTenderStageTaskBoardOptions {
  /** status/preflight/complete = inspect only; start/resume = may dispatch. */
  action: 'preflight' | 'start' | 'status' | 'resume' | 'complete';
  projectDirectory: string;
  projectId: string;
  stageId: string;
  workingDirectory: string;
  parentSessionId?: string;
  tasks: TenderStageBatchTaskSpec[];
  execution?: TenderStageExecutionRuntime;
  maxConcurrency?: number;
}

const DEFAULT_MAX_CONCURRENCY = 4;

export function resolveTenderStageParentBarrier(options: {
  workingDirectory?: string;
  parentSessionId: string;
  businessContext?: {
    module: string;
    projectId: string;
    stageId: string;
  };
}): TenderStageParentBarrier {
  if (!options.workingDirectory || options.businessContext?.module !== 'tender') {
    return emptyParentBarrier();
  }
  const taskBoardPath = join(
    options.workingDirectory,
    '.agent-pi',
    'business',
    'tender',
    options.businessContext.projectId,
    'orchestration',
    'task-boards',
    `${options.businessContext.stageId}.json`,
  );
  const board = readTaskBoard(
    taskBoardPath,
    options.businessContext.projectId,
    options.businessContext.stageId,
  );
  if (!board || board.parentSessionId !== options.parentSessionId || board.tasks.length === 0) {
    return emptyParentBarrier();
  }

  const taskIdentifier = (task: TenderStageTaskRecord): string => task.sessionId ?? task.batchId;
  const reviewSessionIds = board.tasks
    .filter((task) => task.status === 'failed' || task.status === 'blocked')
    .map(taskIdentifier);
  const pendingSessionIds = board.tasks
    .filter((task) => task.status === 'pending' || task.status === 'running')
    .map(taskIdentifier);
  const reportPaths = board.tasks
    .filter((task) => task.status === 'complete')
    .map((task) => task.reportPath);
  const action = reviewSessionIds.length > 0
    ? 'review' as const
    : pendingSessionIds.length > 0
      ? 'wait' as const
      : 'resume' as const;
  return { action, pendingSessionIds, reviewSessionIds, reportPaths, taskBoardPath };
}

function emptyParentBarrier(): TenderStageParentBarrier {
  return { action: 'none', pendingSessionIds: [], reviewSessionIds: [], reportPaths: [] };
}

export async function updateTenderStageTaskBoard(
  options: UpdateTenderStageTaskBoardOptions,
): Promise<TenderStageTaskBoard> {
  const taskBoardPath = join(options.projectDirectory, 'orchestration', 'task-boards', `${options.stageId}.json`);
  const previous = readTaskBoard(taskBoardPath, options.projectId, options.stageId);
  const now = new Date().toISOString();
  const parentSessionId = options.parentSessionId ?? previous?.parentSessionId;
  const previousByBatchId = new Map(previous?.tasks.map((task) => [task.batchId, task]) ?? []);
  const tasks = options.tasks.map((spec) => reconcileTask(spec, previousByBatchId.get(spec.batchId), now));
  let board: TenderStageTaskBoard = {
    schemaVersion: 1,
    projectId: options.projectId,
    stageId: options.stageId,
    ...(parentSessionId ? { parentSessionId } : {}),
    maxConcurrency: options.maxConcurrency ?? previous?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    updatedAt: now,
    tasks,
    taskBoardPath,
  };

  if (options.execution) {
    board = await reconcileRuntime(board, options.execution);
  }
  if (options.action === 'start') {
    board = {
      ...board,
      tasks: board.tasks.map((task) => {
        if (task.status !== 'failed') return task;
        // Quarantine stale invalid reports so retry is not immediately re-failed
        // by the previous schema-invalid handoff while a new child is still writing.
        quarantineInvalidReport(task.reportPath);
        return {
          ...task,
          status: 'pending' as const,
          error: undefined,
          sessionId: undefined,
          lastSessionId: task.sessionId ?? task.lastSessionId,
          linkedIsProcessing: undefined,
          linkedSessionStatus: undefined,
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: now,
        };
      }),
    };
  }
  // Explicit start/resume only — status/preflight never auto-dispatch on app open.
  if (
    options.execution
    && parentSessionId
    && (options.action === 'start' || options.action === 'resume')
  ) {
    board = await dispatchPendingTasks(board, options, options.execution, parentSessionId);
  }

  board = { ...board, updatedAt: new Date().toISOString() };
  atomicWriteJson(taskBoardPath, board);
  return board;
}

function reconcileTask(
  spec: TenderStageBatchTaskSpec,
  previous: TenderStageTaskRecord | undefined,
  now: string,
): TenderStageTaskRecord {
  const base = {
    batchId: spec.batchId,
    name: spec.name,
    briefPath: spec.briefPath,
    reportPath: spec.reportPath,
    allowedSourcePaths: [...spec.allowedSourcePaths],
    attemptCount: previous?.attemptCount ?? 0,
    updatedAt: now,
  };
  if (spec.validationStatus === 'complete') {
    return {
      ...base,
      status: 'complete',
      ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      ...(previous?.startedAt ? { startedAt: previous.startedAt } : {}),
      completedAt: previous?.completedAt ?? now,
    };
  }
  if (spec.validationStatus === 'invalid') {
    // A stale invalid report must not clobber an in-flight retry. Keep the
    // running/pending attempt until reconcileRuntime or a later complete report
    // settles the task.
    if (previous?.status === 'running' || previous?.status === 'pending') {
      return {
        ...base,
        status: previous.status,
        attemptCount: previous.attemptCount,
        ...(previous.sessionId ? { sessionId: previous.sessionId } : {}),
        ...(previous.startedAt ? { startedAt: previous.startedAt } : {}),
        ...(previous.error ? { error: previous.error } : {}),
      };
    }
    return {
      ...base,
      status: 'failed',
      ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      ...(previous?.startedAt ? { startedAt: previous.startedAt } : {}),
      error: spec.validationErrors.join('; ') || 'Batch report failed schema validation.',
    };
  }
  if (!existsSync(spec.briefPath)) {
    return { ...base, status: 'blocked', error: `Task brief is missing: ${spec.briefPath}` };
  }
  const missingSource = spec.allowedSourcePaths.find((path) => !existsSync(path));
  if (missingSource) {
    return { ...base, status: 'blocked', error: `Allowed source is missing: ${missingSource}` };
  }
  if (!previous || previous.status === 'complete') return { ...base, status: 'pending' };
  return {
    ...base,
    status: previous.status,
    ...(previous.sessionId ? { sessionId: previous.sessionId } : {}),
    ...(previous.lastSessionId ? { lastSessionId: previous.lastSessionId } : {}),
    ...(previous.startedAt ? { startedAt: previous.startedAt } : {}),
    ...(previous.error ? { error: previous.error } : {}),
  };
}

async function reconcileRuntime(
  board: TenderStageTaskBoard,
  execution: TenderStageExecutionRuntime,
): Promise<TenderStageTaskBoard> {
  const tasks = await Promise.all(board.tasks.map(async (task): Promise<TenderStageTaskRecord> => {
    const linkId = task.sessionId ?? task.lastSessionId;
    if (!linkId) {
      return {
        ...task,
        linkedIsProcessing: undefined,
        linkedSessionStatus: undefined,
      };
    }
    const session = await execution.getSession(linkId);
    const now = new Date().toISOString();
    if (task.status !== 'running' || !task.sessionId) {
      return {
        ...task,
        linkedIsProcessing: session?.isProcessing,
        linkedSessionStatus: session?.sessionStatus,
        updatedAt: now,
      };
    }
    if (!session) {
      return {
        ...task,
        status: 'failed',
        error: 'Spawned session is no longer available.',
        lastSessionId: task.sessionId,
        linkedIsProcessing: false,
        linkedSessionStatus: undefined,
        updatedAt: now,
      };
    }
    const goalStatus = session.goalState?.status;
    const linked = {
      linkedIsProcessing: session.isProcessing,
      linkedSessionStatus: session.sessionStatus,
    };
    if (session.sessionStatus === 'cancelled' || goalStatus === 'failed' || goalStatus === 'cancelled') {
      return {
        ...task,
        ...linked,
        status: 'failed',
        error: `Spawned session ended without a valid report (${goalStatus ?? session.sessionStatus ?? 'unknown'}).`,
        lastSessionId: task.sessionId,
        updatedAt: now,
      };
    }
    if (!session.isProcessing && (session.sessionStatus === 'done' || goalStatus === 'passed')) {
      return {
        ...task,
        ...linked,
        status: 'failed',
        error: 'Spawned session completed without writing a valid report.',
        lastSessionId: task.sessionId,
        updatedAt: now,
      };
    }
    // After app restart / interrupt, children sit idle (Todo) while the board still
    // claims "running" — that blocks the queue forever. Release the slot for an
    // explicit resume; keep lastSessionId so the panel can open the left-tree session.
    if (!session.isProcessing) {
      return {
        ...task,
        ...linked,
        status: 'pending',
        sessionId: undefined,
        lastSessionId: task.sessionId,
        startedAt: undefined,
        error: '子会话已空闲，请点击「恢复未完任务」重新调度',
        updatedAt: now,
      };
    }
    return { ...task, ...linked, updatedAt: now };
  }));
  return { ...board, tasks, updatedAt: new Date().toISOString() };
}

async function dispatchPendingTasks(
  board: TenderStageTaskBoard,
  options: UpdateTenderStageTaskBoardOptions,
  execution: TenderStageExecutionRuntime,
  parentSessionId: string,
): Promise<TenderStageTaskBoard> {
  const specs = new Map(options.tasks.map((task) => [task.batchId, task]));
  const tasks = [...board.tasks];
  let available = Math.max(0, board.maxConcurrency - tasks.filter((task) => task.status === 'running').length);
  for (let index = 0; index < tasks.length && available > 0; index += 1) {
    const task = tasks[index]!;
    if (task.status !== 'pending') continue;
    const spec = specs.get(task.batchId);
    if (!spec) continue;
    const now = new Date().toISOString();
    try {
      const result = await execution.spawnSession(parentSessionId, {
        name: spec.name,
        prompt: `Read and execute only the structured task brief at ${spec.briefPath}. Follow its qualityStandard and outputSchema exactly. The tender documents attached to this task are the only valid basis for scope, quantities, specifications, and measurement rules. For BOQ pricing, complete one C5.1 pure-direct-cost workpaper per assigned item; a resource database or summary report is not a valid substitute. For resource RATES you MUST verify current market levels via web search/fetch (fuel, wages, plant hire, cement, aggregates, asphalt, subcontract rates) and record each verified rate in rateBasis.webEvidence (url + accessedAt); rates that cannot be verified online stay assumptionStatus "unverified" — never invent a rate. Numbers are plain decimals without thousands separators; allocation weights are 0-1 fractions. Write the complete structured handoff to ${spec.reportPath}. Do not create child sessions and do not write the final merged tender artifact.`,
        workingDirectory: options.workingDirectory,
        briefPath: spec.briefPath,
        reportPath: spec.reportPath,
        attachments: [
          { path: spec.briefPath },
          ...spec.allowedSourcePaths.map((path) => ({ path })),
        ],
      });
      tasks[index] = {
        ...task,
        status: 'running',
        sessionId: result.sessionId,
        lastSessionId: task.sessionId ?? task.lastSessionId,
        attemptCount: task.attemptCount + 1,
        startedAt: now,
        updatedAt: now,
        error: undefined,
        linkedIsProcessing: true,
        linkedSessionStatus: 'todo',
      };
      available -= 1;
    } catch (error) {
      if (isTenderStageCapacityError(error)) {
        // Slot is full or memory-guarded — leave the task queued. An explicit
        // resume (or live monitor after the user opts in) will dispatch later.
        tasks[index] = {
          ...task,
          status: 'pending',
          updatedAt: now,
          error: undefined,
        };
        atomicWriteJson(board.taskBoardPath, { ...board, tasks, updatedAt: now });
        break;
      }
      tasks[index] = {
        ...task,
        status: 'failed',
        attemptCount: task.attemptCount + 1,
        updatedAt: now,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    atomicWriteJson(board.taskBoardPath, { ...board, tasks, updatedAt: now });
  }
  return { ...board, tasks, updatedAt: new Date().toISOString() };
}

function quarantineInvalidReport(reportPath: string): void {
  if (!existsSync(reportPath)) return;
  const stamp = Date.now();
  const quarantinePath = `${reportPath}.invalid.${stamp}`;
  try {
    renameSync(reportPath, quarantinePath);
  } catch {
    // Best-effort: if rename fails, reconcileTask still protects in-flight retries.
  }
}

function readTaskBoard(
  taskBoardPath: string,
  projectId: string,
  stageId: string,
): TenderStageTaskBoard | undefined {
  if (!existsSync(taskBoardPath)) return undefined;
  try {
    const value = JSON.parse(readFileSync(taskBoardPath, 'utf8')) as TenderStageTaskBoard;
    if (value.schemaVersion !== 1 || value.projectId !== projectId || value.stageId !== stageId || !Array.isArray(value.tasks)) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
