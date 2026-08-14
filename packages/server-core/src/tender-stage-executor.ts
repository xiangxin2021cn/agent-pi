import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SpawnSessionRequest, SpawnSessionResult } from '@craft-agent/shared/agent';
import { isSpawnCapacityError } from './sessions/runtime-memory-guard';

export type TenderStageTaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'blocked';

/** Capacity / backpressure signals — keep the task queued, do not mark failed. */
export function isTenderStageCapacityError(error: unknown): boolean {
  return isSpawnCapacityError(error);
}

export interface TenderStageBatchTaskSpec {
  batchId: string;
  briefPath: string;
  reportPath: string;
  /** Customer-facing Markdown deliverable written by the child (path-backed). */
  markdownPath?: string;
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
  /** Customer-facing Markdown deliverable written by the child (path-backed). */
  markdownPath?: string;
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
  /** When false, advance/resume must not spawn new children. Default true. */
  dispatchEnabled?: boolean;
  updatedAt: string;
  tasks: TenderStageTaskRecord[];
  taskBoardPath: string;
}

export type TenderStageBoardAction =
  | 'preflight'
  | 'start'
  | 'status'
  | 'resume'
  | 'advance'
  | 'complete'
  | 'reset_orchestration'
  | 'set_dispatch';

function reportLooksLikeBoqPricing(reportPath: string): boolean {
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { itemBuildUps?: unknown };
    return Array.isArray(report.itemBuildUps) && report.itemBuildUps.length > 0;
  } catch {
    return false;
  }
}

function resetTaskForRetry(task: TenderStageTaskRecord, now: string): TenderStageTaskRecord {
  // Do not quarantine a usable BOQ JSON — retry used to rename valid reports
  // to .invalid and then re-dispatch the closed child.
  if (existsSync(task.reportPath) && !reportLooksLikeBoqPricing(task.reportPath)) {
    quarantineInvalidReport(task.reportPath);
  }
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
    // User retry / start-reset must get a fresh auto-dispatch budget.
    attemptCount: 0,
  };
}

export interface TenderStageParentBarrier {
  action: 'none' | 'wait' | 'resume' | 'review';
  pendingSessionIds: string[];
  reviewSessionIds: string[];
  reportPaths: string[];
  /** Accepted customer-facing Markdown paths from completed child batches. */
  markdownPaths: string[];
  /**
   * Path-backed files to attach on parent resume: JSON reports + Markdown
   * (+ brief when present). Parent must not re-author these; it only reads them.
   */
  handoffArtifactPaths: string[];
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
  /**
   * Re-prompt an existing idle child instead of spawning a duplicate.
   * Must resolve once the prompt is accepted (not after the full agent turn),
   * otherwise resume fill-up serializes to one child. Optional for spawn-only tests.
   */
  continueSession?(sessionId: string, prompt: string): Promise<void>;
}

const CONTINUE_IDLE_CHILD_PROMPT = (
  briefPath: string,
  reportPath: string,
  markdownPath?: string,
): string => (
  `Continue the assigned tender batch. Re-read the brief at ${briefPath} if needed, `
  + `finish any remaining work, and ensure the structured JSON handoff is at ${reportPath}`
  + (markdownPath ? ` plus the Markdown deliverable at ${markdownPath}` : ' plus a Markdown deliverable at the path specified in the brief')
  + `. Do not restart from scratch if progress already exists in this session. `
  + `Do not spawn further child sessions.`
);

export interface UpdateTenderStageTaskBoardOptions {
  /**
   * status/preflight/complete = inspect only;
   * start = bind parent + reset failed→pending, no spawn;
   * advance/resume = may dispatch up to maxConcurrency when dispatchEnabled;
   * set_dispatch = toggle dispatchEnabled;
   * reset_orchestration = clear session bindings, pending queue.
   */
  action: TenderStageBoardAction;
  projectDirectory: string;
  projectId: string;
  stageId: string;
  workingDirectory: string;
  parentSessionId?: string;
  tasks: TenderStageBatchTaskSpec[];
  execution?: TenderStageExecutionRuntime;
  maxConcurrency?: number;
  dispatchEnabled?: boolean;
  /** When set, re-queue only these failed/blocked batches (and re-enable dispatch). */
  retryBatchIds?: string[];
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
  const completed = board.tasks.filter((task) => task.status === 'complete');
  const reportPaths = completed.map((task) => task.reportPath).filter(Boolean);
  const markdownPaths = completed
    .map((task) => resolveTaskMarkdownPath(task))
    .filter((path): path is string => Boolean(path));
  const handoffArtifactPaths = uniqueExistingPaths([
    ...completed.flatMap((task) => [
      task.reportPath,
      resolveTaskMarkdownPath(task),
      task.briefPath,
    ]),
  ]);
  const action = reviewSessionIds.length > 0
    ? 'review' as const
    : pendingSessionIds.length > 0
      ? 'wait' as const
      : 'resume' as const;
  return {
    action,
    pendingSessionIds,
    reviewSessionIds,
    reportPaths,
    markdownPaths,
    handoffArtifactPaths,
    taskBoardPath,
  };
}

function emptyParentBarrier(): TenderStageParentBarrier {
  return {
    action: 'none',
    pendingSessionIds: [],
    reviewSessionIds: [],
    reportPaths: [],
    markdownPaths: [],
    handoffArtifactPaths: [],
  };
}

function resolveTaskMarkdownPath(task: Pick<TenderStageTaskRecord, 'markdownPath' | 'briefPath'>): string | undefined {
  if (task.markdownPath?.trim()) return task.markdownPath;
  return readMarkdownPathFromBrief(task.briefPath);
}

export function readMarkdownPathFromBrief(briefPath: string | undefined): string | undefined {
  if (!briefPath || !existsSync(briefPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(briefPath, 'utf8')) as { markdownPath?: unknown };
    return typeof parsed.markdownPath === 'string' && parsed.markdownPath.trim()
      ? parsed.markdownPath
      : undefined;
  } catch {
    return undefined;
  }
}

function uniqueExistingPaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path?.trim()) continue;
    const key = path.replace(/\\/g, '/').toLowerCase();
    if (seen.has(key) || !existsSync(path)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
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
  const dispatchEnabled = options.action === 'set_dispatch'
    ? options.dispatchEnabled !== false
    : options.dispatchEnabled ?? previous?.dispatchEnabled ?? true;
  let board: TenderStageTaskBoard = {
    schemaVersion: 1,
    projectId: options.projectId,
    stageId: options.stageId,
    ...(parentSessionId ? { parentSessionId } : {}),
    maxConcurrency: options.maxConcurrency ?? previous?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    dispatchEnabled,
    updatedAt: now,
    tasks,
    taskBoardPath,
  };

  if (options.execution) {
    board = await reconcileRuntime(board, options.execution);
  }
  const retryBatchIds = new Set(
    (options.retryBatchIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  if (retryBatchIds.size > 0) {
    board = {
      ...board,
      // Selective retry implies the user wants dispatch again.
      dispatchEnabled: true,
      tasks: board.tasks.map((task) => {
        if (!retryBatchIds.has(task.batchId)) return task;
        if (task.status === 'complete' || task.status === 'running') return task;
        return resetTaskForRetry(task, now);
      }),
    };
  } else if (options.action === 'start') {
    board = {
      ...board,
      tasks: board.tasks.map((task) => {
        if (task.status !== 'failed') return task;
        // Quarantine stale invalid reports so retry is not immediately re-failed
        // by the previous schema-invalid handoff while a new child is still writing.
        return resetTaskForRetry(task, now);
      }),
    };
  }
  if (options.action === 'reset_orchestration') {
    board = {
      ...board,
      tasks: board.tasks.map((task) => {
        if (task.status === 'complete') return task;
        return {
          ...resetTaskForRetry(task, now),
          attemptCount: 0,
        };
      }),
    };
  }
  // advance/resume may dispatch; start / selective-retry reset only bind/re-queue.
  // Pair retryBatchIds with action=advance (or resume) so one click re-runs the batch.
  if (
    options.execution
    && parentSessionId
    && board.dispatchEnabled !== false
    && (options.action === 'advance' || options.action === 'resume')
  ) {
    board = await dispatchPendingTasks(board, options, options.execution, parentSessionId);
  }

  board = { ...board, updatedAt: new Date().toISOString() };
  const skippedWrite = Boolean(previous && taskBoardFingerprint(previous) === taskBoardFingerprint(board));
  if (skippedWrite && previous) return previous;
  atomicWriteJson(taskBoardPath, board);
  return board;
}

function reconcileTask(
  spec: TenderStageBatchTaskSpec,
  previous: TenderStageTaskRecord | undefined,
  now: string,
): TenderStageTaskRecord {
  const markdownPath = spec.markdownPath ?? previous?.markdownPath ?? readMarkdownPathFromBrief(spec.briefPath);
  const base = {
    batchId: spec.batchId,
    name: spec.name,
    briefPath: spec.briefPath,
    reportPath: spec.reportPath,
    ...(markdownPath ? { markdownPath } : {}),
    allowedSourcePaths: [...spec.allowedSourcePaths],
    attemptCount: previous?.attemptCount ?? 0,
    updatedAt: now,
  };
  // Never demote an accepted batch back to pending/failed. A missing report on
  // a later tick (quarantine, path flicker) used to reset complete → pending
  // and the monitor re-dispatched a finished child.
  if (previous?.status === 'complete') {
    return {
      ...base,
      status: 'complete',
      ...(previous.sessionId ? { sessionId: previous.sessionId } : {}),
      ...(previous.lastSessionId ? { lastSessionId: previous.lastSessionId } : {}),
      ...(previous.startedAt ? { startedAt: previous.startedAt } : {}),
      completedAt: previous.completedAt ?? now,
    };
  }
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
        error: spec.validationErrors.length > 0
          ? spec.validationErrors.join('; ')
          : previous.error,
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
  if (!previous) return { ...base, status: 'pending' };
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
      if (task.linkedIsProcessing === undefined && task.linkedSessionStatus === undefined) {
        return task;
      }
      return {
        ...task,
        linkedIsProcessing: undefined,
        linkedSessionStatus: undefined,
      };
    }
    const session = await execution.getSession(linkId);
    const now = new Date().toISOString();
    const linkedUnchanged = (
      session: { isProcessing: boolean; sessionStatus?: string },
    ) => (
      task.linkedIsProcessing === session.isProcessing
      && task.linkedSessionStatus === session.sessionStatus
    );
    if (!session) {
      // Board still points at a deleted left-rail session. Clear live sessionId
      // so resume can spawn cleanly; keep lastSessionId for UI history.
      return {
        ...task,
        status: task.status === 'running' ? 'failed' : task.status,
        sessionId: undefined,
        lastSessionId: task.sessionId ?? task.lastSessionId,
        linkedIsProcessing: false,
        linkedSessionStatus: undefined,
        error: task.status === 'running'
          ? 'Spawned session is no longer available.'
          : (task.error ?? '原绑定子会话已不存在，恢复时将新建'),
        updatedAt: now,
      };
    }
    if (task.status !== 'running' || !task.sessionId) {
      if (linkedUnchanged(session)) return task;
      return {
        ...task,
        linkedIsProcessing: session.isProcessing,
        linkedSessionStatus: session.sessionStatus,
        updatedAt: now,
      };
    }
    const goalStatus = session.goalState?.status;
    const linked = {
      linkedIsProcessing: session.isProcessing,
      linkedSessionStatus: session.sessionStatus,
    };
    if (session.sessionStatus === 'cancelled' || goalStatus === 'cancelled') {
      return {
        ...task,
        ...linked,
        status: 'failed',
        error: `Spawned session ended without a valid report (${goalStatus ?? session.sessionStatus ?? 'unknown'}).`,
        lastSessionId: task.sessionId,
        updatedAt: now,
      };
    }
    const reportExists = existsSync(task.reportPath);
    const sessionClosed = !session.isProcessing;
    const sessionTerminal = session.sessionStatus === 'done' || goalStatus === 'passed' || goalStatus === 'failed';
    // Pi children stay `todo` after the turn ends. Treat idle the same as
    // done/passed when a report is already on disk — otherwise the monitor
    // keeps Continue-ing a closed child.
    if (sessionClosed && (sessionTerminal || reportExists)) {
      if (reportExists && !task.error) {
        return {
          ...task,
          ...linked,
          status: 'complete',
          sessionId: task.sessionId,
          lastSessionId: task.sessionId,
          completedAt: task.completedAt ?? now,
          error: undefined,
          updatedAt: now,
        };
      }
      if (reportExists) {
        return {
          ...task,
          ...linked,
          status: 'failed',
          error: task.error,
          lastSessionId: task.sessionId,
          updatedAt: now,
        };
      }
      return {
        ...task,
        ...linked,
        status: 'failed',
        error: 'Spawned session completed without writing a valid report.',
        lastSessionId: task.sessionId,
        updatedAt: now,
      };
    }
    // After app restart / interrupt, children sit idle with no report yet.
    // Free the slot (pending) but KEEP sessionId so resume continues the same child.
    //
    // Grace-period guard: dispatchPendingTasks stamps linkedIsProcessing=true right after
    // sending a Continue. If the session hasn't started yet (isProcessing still false on the
    // very next reconcileRuntime call), task.linkedIsProcessing is still true from the stamp.
    // Resetting to pending immediately would cause a second Continue to fire before the child
    // processes the first one.  Give the session one tick to start before treating it as idle.
    if (sessionClosed) {
      if (task.linkedIsProcessing === true) {
        // Update linkedIsProcessing to false (session is idle); will reset to pending NEXT tick.
        return { ...task, ...linked, updatedAt: now };
      }
      return {
        ...task,
        ...linked,
        status: 'pending',
        sessionId: task.sessionId,
        lastSessionId: task.sessionId,
        startedAt: undefined,
        error: '子会话已空闲，恢复时将接续同一会话（不会新建）',
        updatedAt: now,
      };
    }
    if (linkedUnchanged(session)) return task;
    return { ...task, ...linked, updatedAt: now };
  }));
  return { ...board, tasks, updatedAt: new Date().toISOString() };
}

/** Stop auto-flooding a single batch after many failed acceptance loops. */
const MAX_AUTO_DISPATCH_ATTEMPTS = 6;

async function dispatchPendingTasks(
  board: TenderStageTaskBoard,
  options: UpdateTenderStageTaskBoardOptions,
  execution: TenderStageExecutionRuntime,
  parentSessionId: string,
): Promise<TenderStageTaskBoard> {
  const specs = new Map(options.tasks.map((task) => [task.batchId, task]));
  const tasks = [...board.tasks];
  let available = Math.max(0, board.maxConcurrency - tasks.filter((task) => task.status === 'running').length);

  type DispatchJob =
    | { index: number; kind: 'adopt-running'; reusableId: string; sessionStatus?: string }
    | { index: number; kind: 'continue'; reusableId: string; spec: TenderStageBatchTaskSpec }
    | { index: number; kind: 'spawn'; spec: TenderStageBatchTaskSpec };

  const jobs: DispatchJob[] = [];

  for (let index = 0; index < tasks.length && available > 0; index += 1) {
    const task = tasks[index]!;
    if (task.status !== 'pending') continue;
    const spec = specs.get(task.batchId);
    if (!spec) continue;
    // Belt-and-suspenders: if the manifest already shows complete, mark it so and skip dispatch.
    // reconcileTask normally handles this; this guard defends against an out-of-order board write.
    if (spec.validationStatus === 'complete') {
      const now = new Date().toISOString();
      tasks[index] = {
        ...task,
        status: 'complete',
        completedAt: task.completedAt ?? now,
        updatedAt: now,
        error: undefined,
      };
      continue;
    }
    const now = new Date().toISOString();
    const userRetry = Boolean(options.retryBatchIds?.includes(task.batchId));
    if (task.attemptCount >= MAX_AUTO_DISPATCH_ATTEMPTS && !userRetry) {
      tasks[index] = {
        ...task,
        status: 'failed',
        updatedAt: now,
        error: `已自动派发 ${task.attemptCount} 次仍未验收通过。请打开子会话确认 JSON+MD 已写入后点「重试」，或检查报告是否被误封存为 .invalid。`,
      };
      continue;
    }

    const reusableId = task.sessionId ?? task.lastSessionId;
    if (reusableId) {
      const existing = await execution.getSession(reusableId);
      const cancelled = existing?.sessionStatus === 'cancelled'
        || existing?.goalState?.status === 'cancelled';
      const finished = existing?.sessionStatus === 'done'
        || existing?.goalState?.status === 'passed'
        || existing?.goalState?.status === 'failed';
      if (existing && !cancelled) {
        if (existing.isProcessing) {
          jobs.push({
            index,
            kind: 'adopt-running',
            reusableId,
            sessionStatus: existing.sessionStatus,
          });
          available -= 1;
          continue;
        }
        const reportExists = existsSync(spec.reportPath);
        if (finished || reportExists) {
          // Closed children with a report must not be Continue-d. Reconcile
          // already settled them (or will on the next status tick).
          continue;
        }
        if (execution.continueSession) {
          jobs.push({ index, kind: 'continue', reusableId, spec });
          available -= 1;
          continue;
        }
      }
    }

    jobs.push({ index, kind: 'spawn', spec });
    available -= 1;
  }

  const stampAdopt = new Date().toISOString();
  for (const job of jobs) {
    if (job.kind !== 'adopt-running') continue;
    const task = tasks[job.index]!;
    tasks[job.index] = {
      ...task,
      status: 'running',
      sessionId: job.reusableId,
      lastSessionId: job.reusableId,
      startedAt: task.startedAt ?? stampAdopt,
      updatedAt: stampAdopt,
      error: undefined,
      linkedIsProcessing: true,
      linkedSessionStatus: job.sessionStatus,
    };
  }

  // Continues must kick in parallel so resume fills maxConcurrency, but after
  // OS sleep/wake a full parallel cold-start of N Pi subprocesses can OOM the
  // Electron main process. Chunk continues; keep spawns serial for capacity gates.
  const CONTINUE_CHUNK_SIZE = 2;
  const continueJobs = jobs.filter((job): job is Extract<DispatchJob, { kind: 'continue' }> => job.kind === 'continue');
  const spawnJobs = jobs.filter((job): job is Extract<DispatchJob, { kind: 'spawn' }> => job.kind === 'spawn');

  const continueResults: Array<
    | { index: number; ok: true; kind: 'continue'; sessionId: string }
    | { index: number; ok: false; error: unknown }
  > = [];
  for (let offset = 0; offset < continueJobs.length; offset += CONTINUE_CHUNK_SIZE) {
    const chunk = continueJobs.slice(offset, offset + CONTINUE_CHUNK_SIZE);
    const chunkResults = await Promise.all(chunk.map(async (job) => {
      try {
        await execution.continueSession!(
          job.reusableId,
          CONTINUE_IDLE_CHILD_PROMPT(job.spec.briefPath, job.spec.reportPath, job.spec.markdownPath),
        );
        return {
          index: job.index,
          ok: true as const,
          kind: 'continue' as const,
          sessionId: job.reusableId,
        };
      } catch (error) {
        return { index: job.index, ok: false as const, error };
      }
    }));
    continueResults.push(...chunkResults);
    if (chunkResults.some((result) => !result.ok && isTenderStageCapacityError(result.error))) {
      // Memory/capacity pressure — leave remaining continues pending.
      break;
    }
  }

  const spawnResults: Array<
    | { index: number; ok: true; kind: 'spawn'; sessionId: string }
    | { index: number; ok: false; error: unknown }
  > = [];
  for (const job of spawnJobs) {
    try {
      const result = await execution.spawnSession(parentSessionId, {
        name: job.spec.name,
        prompt: `Read the task brief at ${job.spec.briefPath} and produce useful analysis/pricing for the attached tender sources only. `
          + `Write a structured JSON handoff to ${job.spec.reportPath} and a readable Markdown deliverable to brief.markdownPath when provided. `
          + `Prefer substance over format ritual: wrong batchId is auto-corrected; empty sourceRefs are accepted; do not burn tokens inventing IDs or chasing filenames. `
          + `For BOQ pricing: price the assigned items with plain decimal rates (verify market rates via web when possible; otherwise mark unverified — never invent). `
          + `Do not spawn further child sessions and do not write the final merged project pack.`,
        workingDirectory: options.workingDirectory,
        briefPath: job.spec.briefPath,
        reportPath: job.spec.reportPath,
        dispatchSource: 'stage-controller',
        attachments: [
          { path: job.spec.briefPath },
          ...job.spec.allowedSourcePaths.map((path) => ({ path })),
        ],
      });
      spawnResults.push({
        index: job.index,
        ok: true,
        kind: 'spawn',
        sessionId: result.sessionId,
      });
    } catch (error) {
      spawnResults.push({ index: job.index, ok: false, error });
      if (isTenderStageCapacityError(error)) {
        // Leave remaining spawn jobs untouched (still pending on the board).
        break;
      }
    }
  }

  const kickResults = [...continueResults, ...spawnResults];

  const now = new Date().toISOString();
  for (const result of kickResults) {
    const task = tasks[result.index]!;
    if (result.ok) {
      tasks[result.index] = {
        ...task,
        status: 'running',
        sessionId: result.sessionId,
        lastSessionId: task.sessionId ?? task.lastSessionId ?? result.sessionId,
        // Continuations do not burn auto-dispatch attempts — same child, not a new spawn.
        attemptCount: result.kind === 'spawn' ? task.attemptCount + 1 : task.attemptCount,
        startedAt: now,
        updatedAt: now,
        error: undefined,
        linkedIsProcessing: true,
        linkedSessionStatus: 'todo',
      };
      continue;
    }
    if (isTenderStageCapacityError(result.error)) {
      tasks[result.index] = {
        ...task,
        status: 'pending',
        updatedAt: now,
        error: undefined,
      };
      continue;
    }
    tasks[result.index] = {
      ...task,
      status: 'failed',
      attemptCount: task.attemptCount + 1,
      updatedAt: now,
      error: result.error instanceof Error ? result.error.message : String(result.error),
    };
  }

  atomicWriteJson(board.taskBoardPath, { ...board, tasks, updatedAt: now });
  return { ...board, tasks, updatedAt: now };
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

/** Read maxConcurrency from the live stage task board (if present). */
export function readTenderStageBoardMaxConcurrency(options: {
  workingDirectory?: string;
  projectId?: string;
  stageId?: string;
}): number | undefined {
  if (!options.workingDirectory || !options.projectId || !options.stageId) return undefined;
  const taskBoardPath = join(
    options.workingDirectory,
    '.agent-pi',
    'business',
    'tender',
    options.projectId,
    'orchestration',
    'task-boards',
    `${options.stageId}.json`,
  );
  const board = readTaskBoard(taskBoardPath, options.projectId, options.stageId);
  return typeof board?.maxConcurrency === 'number' && board.maxConcurrency > 0
    ? board.maxConcurrency
    : undefined;
}

/**
 * When the parent agent spawns with a reportPath that matches a pending/failed
 * board task, mark that task running so Overview / 流程监控 stay aligned.
 */
export function bindTenderStageTaskToSpawnedSession(options: {
  workingDirectory?: string;
  projectId?: string;
  stageId?: string;
  parentSessionId: string;
  childSessionId: string;
  reportPath: string;
  briefPath?: string;
  name?: string;
}): boolean {
  if (!options.workingDirectory || !options.projectId || !options.stageId) return false;
  const taskBoardPath = join(
    options.workingDirectory,
    '.agent-pi',
    'business',
    'tender',
    options.projectId,
    'orchestration',
    'task-boards',
    `${options.stageId}.json`,
  );
  const board = readTaskBoard(taskBoardPath, options.projectId, options.stageId);
  if (!board) return false;

  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  const targetReport = normalize(options.reportPath);
  const index = board.tasks.findIndex((task) => normalize(task.reportPath) === targetReport);
  if (index < 0) return false;

  const previous = board.tasks[index]!;
  if (previous.status === 'complete') return false;

  const now = new Date().toISOString();
  board.tasks[index] = {
    ...previous,
    status: 'running',
    sessionId: options.childSessionId,
    lastSessionId: previous.sessionId ?? previous.lastSessionId,
    attemptCount: previous.attemptCount + (previous.status === 'running' ? 0 : 1),
    startedAt: previous.startedAt ?? now,
    updatedAt: now,
    error: undefined,
    linkedIsProcessing: true,
    linkedSessionStatus: 'todo',
    ...(options.briefPath ? { briefPath: options.briefPath } : {}),
    ...(options.name ? { name: options.name } : {}),
  };
  board.parentSessionId = options.parentSessionId;
  board.updatedAt = now;
  atomicWriteJson(taskBoardPath, board);
  return true;
}

function taskBoardFingerprint(board: TenderStageTaskBoard): string {
  const { updatedAt: _updatedAt, ...rest } = board;
  return JSON.stringify({
    ...rest,
    tasks: board.tasks.map(({ updatedAt: _taskUpdatedAt, ...task }) => task),
  });
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
