import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { listBusinessProjects } from '@craft-agent/shared/business-projects';
import {
  applyManualTenderCloseoutEvidence,
  createNodeFileSystem,
  handleTenderCapability,
  handleTenderWorkspace,
  mergeBoqBatchReports,
  type SessionToolContext,
} from '@craft-agent/session-tools-core';
import {
  parseTenderCapabilityIndex,
  parseTenderCapabilityEnvelope,
  parseTenderBoqReconciliationData,
  parseTenderWorkspace,
  type TenderCapabilityId,
  type TenderCapabilityIndex,
  type TenderDocument,
  type TenderDocumentKind,
  type TenderWorkspace,
} from '@agent-pi/business-core/tender';
import {
  createOrRefreshBoqBatchManifest,
  validateBoqBatchMerge,
  type TenderBoqBatchManifest,
} from './tender-boq-batches.ts';
import { writeDocumentAnalysisSummaryMarkdown } from './tender-document-analysis-md.ts';
import { ensureDefaultTenderBindings } from './tender-bindings.ts';
import {
  assertDocumentParseGate,
  ensureDocumentReviewEntries,
  markDocumentHumanReview,
  readDocumentReviewLedger,
} from './tender-document-artifacts.ts';
import {
  createOrRefreshDocumentAnalysisBatchManifest,
  mergeDocumentAnalysisBatchReports,
  validateDocumentAnalysisBatchMerge,
  type TenderDocumentAnalysisBatchManifest,
} from './tender-document-batches.ts';
import { migrateTenderStageState } from './tender-orchestration-migrate.ts';
import {
  bindProjectParentSession,
  rebindAllTaskBoardParents,
  resolveOrElectProjectParent,
} from './tender-project-orchestration.ts';
import {
  assertPlanningSubstepGate,
  evaluatePlanningSubsteps,
  markPlanningMethodologyReview,
  type PlanningSubstepState,
} from './tender-planning-gates.ts';
import { setSessionBusinessStage } from '@craft-agent/shared/sessions';
import {
  assertResourceScheduleArtifacts,
  writeConstructionResourceScheduleArtifacts,
} from './tender-resource-schedule.ts';
import {
  updateTenderStageTaskBoard,
  type TenderStageBatchTaskSpec,
  type TenderStageExecutionRuntime,
  type TenderStageTaskBoard,
  type TenderStageTaskRecord,
} from './tender-stage-executor.ts';

export type TenderStageRunAction =
  | 'preflight'
  | 'start'
  | 'status'
  | 'resume'
  | 'advance'
  | 'complete'
  | 'reset_orchestration'
  | 'set_dispatch';
export type TenderStageRunStatus = 'blocked' | 'ready' | 'running' | 'complete';

export interface TenderStageRunRequest {
  action: TenderStageRunAction;
  workspaceRootPath: string;
  projectId: string;
  stageId: string;
  parentSessionId?: string;
  dispatchEnabled?: boolean;
  documentReview?: {
    documentId: string;
    humanReview: 'accepted' | 'rejected';
    notes?: string;
  };
  /** Mark 4-A methodology report as human-accepted/rejected. */
  planningReview?: {
    artifact: 'methodology_report';
    humanReview: 'accepted' | 'rejected';
    notes?: string;
  };
  /** Allow replacing the project parent pointer (migration / recovery). */
  forceRebindParent?: boolean;
  /** Selective retry of failed/blocked batches (quarantine + re-queue). */
  retryBatchIds?: string[];
}

export interface TenderStageRunOptions {
  execution?: TenderStageExecutionRuntime;
  /** Refresh live session businessContext.stageId when the project parent advances. */
  setBusinessContextStage?: (sessionId: string, stageId: string) => Promise<boolean>;
  /** True when the session is still in the live SessionManager index (not deleted). */
  isSessionAlive?: (sessionId: string) => boolean;
  /**
   * Alive root sessions for this tender project (sidebar-equivalent).
   * Used to heal stale project-orchestration pointers on old projects.
   */
  listAliveProjectSessionIds?: (projectId: string) => string[];
}

export interface TenderSourceBoundaryFile {
  documentId: string;
  path: string;
  name: string;
  kind: TenderDocumentKind;
  priority: number;
  status: 'registered' | 'missing' | 'unsupported';
  sizeBytes?: number;
}

export interface TenderSourceBoundary {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  files: TenderSourceBoundaryFile[];
  registeredCount: number;
  missingPaths: string[];
}

export interface TenderStageRunResult {
  schemaVersion: 1;
  projectId: string;
  stageId: string;
  status: TenderStageRunStatus;
  requiredCapabilities: TenderCapabilityId[];
  producedCapabilities: TenderCapabilityId[];
  generatedPacks: TenderCapabilityId[];
  missingItems: string[];
  batchProgress?: {
    batchType: 'document_analysis' | 'boq_five_step_pricing';
    itemCount: number;
    batchCount: number;
    completedBatches: number;
    missingItemCount: number;
    manifestPath: string;
    taskBoardPath?: string;
    parentSessionId?: string;
    pendingBatches: number;
    runningBatches: number;
    failedBatches: number;
    blockedBatches: number;
    tasks: TenderStageTaskRecord[];
    /** Batches whose reports failed acceptance, with the top reasons. */
    invalidBatches?: Array<{ batchId: string; errors: string[] }>;
    /** Non-blocking normalization notes collected while accepting reports. */
    validationWarningCount?: number;
    /** Reconciliation rows excluded from pricing (summary rows, composites). */
    skippedItems?: Array<{ itemId: string; code: string; reason: string }>;
  };
  /** Visible 4-A / 4-B / 4-C checklist for planning-and-submission. */
  substeps?: PlanningSubstepState[];
  /** True when stage-state.json still carries folded V2.4 legacy keys. */
  migratedFromLegacy?: boolean;
  /** Single project-lifetime parent session shared across stages. */
  projectParentSessionId?: string;
  sourceBoundary: TenderSourceBoundary;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  paths: {
    projectDirectory: string;
    workspacePath: string;
    sourceBoundaryPath: string;
    stageStatePath: string;
    documentAnalysisBatchManifestPath?: string;
    boqBatchManifestPath?: string;
    taskBoardPath?: string;
  };
}

interface TenderStageDefinition {
  id: string;
  requiredCapabilities: TenderCapabilityId[];
  producedCapabilities: TenderCapabilityId[];
}

interface PersistedTenderStageState {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  stages: Record<string, Omit<TenderStageRunResult, 'sourceBoundary' | 'paths'>>;
  migratedFromLegacy?: boolean;
}

// V2.5: 4 business stages. evaluation_strategy is optional (not in producedCapabilities).
// planning + submission collapse into planning-and-submission with UI substeps.
// Legacy stage ids resolve through STAGE_ALIASES so existing projects keep loading.
const STAGES: TenderStageDefinition[] = [
  { id: 'project-setup', requiredCapabilities: [], producedCapabilities: [] },
  {
    id: 'tender-document-analysis',
    requiredCapabilities: [],
    producedCapabilities: ['document_analysis', 'boq_reconciliation'],
  },
  {
    id: 'boq-five-step-pricing',
    requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
    producedCapabilities: ['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'],
  },
  {
    id: 'planning-and-submission',
    requiredCapabilities: ['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'],
    producedCapabilities: [
      'execution_plan',
      'schedule_resources',
      'cost_cashflow',
      'submission_documents',
      'submission_audit',
    ],
  },
];

const STAGE_ALIASES: Record<string, string> = {
  'bidder-commitments': 'boq-five-step-pricing',
  planning: 'planning-and-submission',
  submission: 'planning-and-submission',
  'work-plan-methodology': 'planning-and-submission',
  'schedule-resource-planning': 'planning-and-submission',
  'cost-cashflow-planning': 'planning-and-submission',
  'tender-submission-documents': 'planning-and-submission',
  'submission-audit': 'planning-and-submission',
};

function canonicalStageId(stageId: string): string {
  return STAGE_ALIASES[stageId] ?? stageId;
}

/** Serialize stage runs so parallel Overview/Host ticks cannot starve short RPCs. */
let tenderStageRunChain: Promise<unknown> = Promise.resolve();

export async function runTenderStage(
  request: TenderStageRunRequest,
  options: TenderStageRunOptions = {},
): Promise<TenderStageRunResult> {
  const previous = tenderStageRunChain;
  let release!: () => void;
  tenderStageRunChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await runTenderStageUnlocked(request, options);
  } finally {
    release();
  }
}

async function runTenderStageUnlocked(
  request: TenderStageRunRequest,
  options: TenderStageRunOptions = {},
): Promise<TenderStageRunResult> {
  const project = listBusinessProjects(request.workspaceRootPath, 'tender')
    .find((candidate) => candidate.projectId === request.projectId);
  if (!project) throw new Error(`Tender Business Project ${request.projectId} does not exist.`);
  const stage = STAGES.find((candidate) => candidate.id === canonicalStageId(request.stageId));
  if (!stage) throw new Error(`Unknown tender stage: ${request.stageId}`);

  const paths = resolvePaths(project.rootPath, project.projectId);
  ensureDefaultTenderBindings(paths.projectDirectory);

  // Resolve / elect the single project parent before any stage dispatch.
  // Prefer live sessions only — old project pointers to deleted parents must heal.
  const isSessionAlive = options.isSessionAlive ?? (() => true);
  const persistedPreview = readStageState(paths.stageStatePath, project.projectId);
  const candidatesFromState = Object.values(persistedPreview.stages)
    .map((entry) => entry.batchProgress?.parentSessionId)
    .filter((id): id is string => Boolean(id));
  const aliveProjectSessions = options.listAliveProjectSessionIds?.(project.projectId) ?? [];
  const requestedParentAlive = Boolean(
    request.parentSessionId
    && isSessionAlive(request.parentSessionId),
  );
  const resolvedParent = resolveOrElectProjectParent({
    projectDirectory: paths.projectDirectory,
    projectId: project.projectId,
    candidateSessionIds: [
      ...(requestedParentAlive && request.parentSessionId ? [request.parentSessionId] : []),
      ...aliveProjectSessions,
      ...candidatesFromState,
    ],
    isSessionAlive,
  });
  let projectParentSessionId = resolvedParent.parentSessionId;
  let parentMismatch: string | undefined;
  let electedMultiParent = (
    (resolvedParent.elected || resolvedParent.healedStalePointer)
    && resolvedParent.legacyParentSessionIds.length > 0
  );

  if (requestedParentAlive && request.parentSessionId) {
    const pointerAlive = Boolean(projectParentSessionId && isSessionAlive(projectParentSessionId));
    // Auto-rebind when the stored pointer is dead/missing, or the caller forces it.
    const shouldRebind = request.forceRebindParent
      || !pointerAlive
      || resolvedParent.elected
      || resolvedParent.healedStalePointer;
    if (
      projectParentSessionId
      && projectParentSessionId !== request.parentSessionId
      && pointerAlive
      && !shouldRebind
    ) {
      parentMismatch = `project-parent:mismatch:${projectParentSessionId}`;
    } else {
      bindProjectParentSession(paths.projectDirectory, project.projectId, request.parentSessionId);
      projectParentSessionId = request.parentSessionId;
      rebindAllTaskBoardParents(paths.projectDirectory, request.parentSessionId);
    }
  } else if ((resolvedParent.elected || resolvedParent.healedStalePointer) && projectParentSessionId) {
    rebindAllTaskBoardParents(paths.projectDirectory, projectParentSessionId);
  }

  const requestedParentForBoard = requestedParentAlive ? request.parentSessionId : undefined;
  const resolvedBoardParent = parentMismatch
    ? projectParentSessionId
    : (requestedParentForBoard ?? projectParentSessionId);
  // Never write/dispatch against a deleted parent — that produced
  // "Parent session … does not exist" storms on old projects.
  const boardParentSessionId = resolvedBoardParent && isSessionAlive(resolvedBoardParent)
    ? resolvedBoardParent
    : undefined;

  if (
    boardParentSessionId
    && isSessionAlive(boardParentSessionId)
    && (request.action === 'start' || request.action === 'advance' || request.action === 'resume')
  ) {
    if (options.setBusinessContextStage) {
      await options.setBusinessContextStage(boardParentSessionId, stage.id);
    } else {
      await setSessionBusinessStage(request.workspaceRootPath, boardParentSessionId, stage.id);
    }
  }

  const context = createContext(project.rootPath);
  const sourceBoundary = await syncSourceBoundary(context, paths, project);
  const workspace = parseTenderWorkspace(readJson(paths.workspacePath));
  let capabilityIndex = existsSync(paths.capabilityIndexPath)
    ? parseTenderCapabilityIndex(readJson(paths.capabilityIndexPath))
    : { schemaVersion: 1 as const, projectId: project.projectId, coreRevision: workspace.revision, capabilities: [] };
  const manualEvidence = applyManualTenderCloseoutEvidence(capabilityIndex, {
    projectDirectory: paths.projectDirectory,
    workingDirectory: project.rootPath,
    coreRevision: workspace.revision,
  });
  if (manualEvidence.changed) {
    capabilityIndex = manualEvidence.index;
    atomicWriteJson(paths.capabilityIndexPath, capabilityIndex);
  }
  let capabilityIndexLive: TenderCapabilityIndex = capabilityIndex;
  let generatedPacks = listReadyPacks(capabilityIndexLive);
  const documentBatchManifest = stage.id === 'tender-document-analysis'
    ? await createOrRefreshDocumentAnalysisBatchManifest(
        paths.projectDirectory,
        project.projectId,
        sourceBoundary.files
          .filter((file) => file.status === 'registered')
          .map((file) => ({
            documentId: file.documentId,
            path: file.path,
            name: file.name,
            kind: file.kind,
            priority: file.priority,
          })),
        { projectRoot: project.rootPath },
      )
    : undefined;
  if (stage.id === 'tender-document-analysis') {
    ensureDocumentReviewEntries(
      paths.projectDirectory,
      project.projectId,
      project.rootPath,
      sourceBoundary.files
        .filter((file) => file.status === 'registered')
        .map((file) => ({ documentId: file.documentId, name: file.name })),
    );
  }
  if (request.documentReview && stage.id === 'tender-document-analysis') {
    const source = sourceBoundary.files.find((file) => file.documentId === request.documentReview!.documentId);
    markDocumentHumanReview({
      projectDirectory: paths.projectDirectory,
      projectId: project.projectId,
      projectRoot: project.rootPath,
      documentId: request.documentReview.documentId,
      humanReview: request.documentReview.humanReview,
      sourceName: source?.name,
      notes: request.documentReview.notes,
    });
  }
  if (
    request.planningReview
    && request.planningReview.artifact === 'methodology_report'
    && stage.id === 'planning-and-submission'
  ) {
    markPlanningMethodologyReview({
      projectDirectory: paths.projectDirectory,
      projectId: project.projectId,
      projectRoot: project.rootPath,
      humanReview: request.planningReview.humanReview,
      notes: request.planningReview.notes,
    });
  }
  const boqBatchManifest = stage.id === 'boq-five-step-pricing'
    ? loadBoqBatchManifest(paths, project.projectId, generatedPacks, sourceBoundary, project.rootPath)
    : undefined;
  const batchTaskSpecs = buildBatchTaskSpecs(documentBatchManifest, boqBatchManifest, sourceBoundary);
  const defaultConcurrency = defaultStageConcurrency(stage.id);
  const taskBoard = batchTaskSpecs
    ? await updateTenderStageTaskBoard({
        action: request.action,
        projectDirectory: paths.projectDirectory,
        projectId: project.projectId,
        stageId: stage.id,
        workingDirectory: project.rootPath,
        parentSessionId: boardParentSessionId,
        tasks: batchTaskSpecs,
        execution: options.execution,
        maxConcurrency: defaultConcurrency,
        ...(request.dispatchEnabled !== undefined ? { dispatchEnabled: request.dispatchEnabled } : {}),
        ...(request.retryBatchIds?.length ? { retryBatchIds: request.retryBatchIds } : {}),
      })
    : undefined;

  // When every document-analysis batch is complete, deterministically merge into
  // packs/document-analysis.json and write a readable summary under formal outputs.
  const documentMergeRuntimeErrors: string[] = [];
  if (
    stage.id === 'tender-document-analysis'
    && documentBatchManifest
    && documentBatchManifest.batchCount > 0
    && documentBatchManifest.completedBatches === documentBatchManifest.batchCount
    && documentBatchManifest.missingDocumentIds.length === 0
    && documentBatchManifest.batches.every((batch) => batch.status === 'complete')
  ) {
    const parentSessionId = taskBoard?.parentSessionId ?? request.parentSessionId;
    const mergeResult = await ensureDocumentAnalysisPackMerged({
      context,
      paths,
      projectId: project.projectId,
      workingDirectory: project.rootPath,
      manifest: documentBatchManifest,
      parentSessionId,
    });
    documentMergeRuntimeErrors.push(...mergeResult.errors);
    if (existsSync(paths.capabilityIndexPath)) {
      capabilityIndexLive = parseTenderCapabilityIndex(readJson(paths.capabilityIndexPath));
      generatedPacks = listSatisfiedPacks(capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest);
    }
  } else {
    generatedPacks = listSatisfiedPacks(capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest);
  }

  // Same deterministic ownership for BOQ pricing: once every pricing batch is
  // complete, merge child reports into packs/boq-five-step-pricing.json instead
  // of letting the parent hand-assemble (and compress) the pack.
  const boqMergeRuntimeErrors: string[] = [];
  const resourceScheduleRuntimeErrors: string[] = [];
  if (
    stage.id === 'boq-five-step-pricing'
    && boqBatchManifest
    && boqBatchManifest.batchCount > 0
    && boqBatchManifest.completedBatches === boqBatchManifest.batchCount
    && boqBatchManifest.missingItemIds.length === 0
    && boqBatchManifest.batches.every((batch) => batch.status === 'complete')
  ) {
    const mergeResult = await ensureBoqPackMerged({
      context,
      paths,
      projectId: project.projectId,
      manifest: boqBatchManifest,
      workspace,
    });
    boqMergeRuntimeErrors.push(...mergeResult.errors);
    if (mergeResult.errors.length === 0) {
      const scheduleResult = await ensureResourceSchedulePack({
        context,
        paths,
        projectId: project.projectId,
        projectRoot: project.rootPath,
      });
      resourceScheduleRuntimeErrors.push(...scheduleResult.errors);
    }
    if (existsSync(paths.capabilityIndexPath)) {
      capabilityIndexLive = parseTenderCapabilityIndex(readJson(paths.capabilityIndexPath));
      generatedPacks = listSatisfiedPacks(capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest);
    }
  }

  const persisted = persistedPreview;
  const previous = persisted.stages[stage.id] ?? latestLegacyStageState(persisted, stage.id);
  const baseMissingItems = [
    ...sourceBoundary.missingPaths.map((path) => `source:${path}`),
    ...(sourceBoundary.registeredCount === 0 ? ['source:registered-file-required'] : []),
    ...stage.requiredCapabilities
      .filter((capability) => !isCapabilitySatisfied(capability, capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest))
      .map((capability) => `capability:${capability}`),
    ...(parentMismatch ? [parentMismatch] : []),
  ];
  if (stage.id === 'tender-document-analysis') {
    if (!documentBatchManifest) baseMissingItems.push('document-batches:manifest-unavailable');
    else if (documentBatchManifest.documentCount === 0) baseMissingItems.push('document-batches:no-documents');
  }
  if (stage.id === 'boq-five-step-pricing') {
    if (!boqBatchManifest) baseMissingItems.push('boq-batches:manifest-unavailable');
    else if (boqBatchManifest.itemCount === 0) baseMissingItems.push('boq-batches:no-items');
  }
  if (
    taskBoard
    && options.execution
    && (request.action === 'start' || request.action === 'resume' || request.action === 'advance')
    && !taskBoard.parentSessionId
  ) {
    baseMissingItems.push('task-board:parent-session-required');
  }
  if (taskBoard) {
    const failedTasks = taskBoard.tasks.filter((task) => task.status === 'failed').length;
    const blockedTasks = taskBoard.tasks.filter((task) => task.status === 'blocked').length;
    if (failedTasks > 0) baseMissingItems.push(`task-board:failed:${failedTasks}`);
    if (blockedTasks > 0) baseMissingItems.push(`task-board:blocked:${blockedTasks}`);
  }
  const shouldEvaluateCompletion = request.action === 'complete'
    || (
      (request.action === 'status' || request.action === 'resume')
      && (previous?.status === 'running' || previous?.status === 'complete')
    );
  const completionMissingItems: string[] = [];
  if (shouldEvaluateCompletion) {
    completionMissingItems.push(...stage.producedCapabilities
      .filter((capability) => !isCapabilitySatisfied(capability, capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest))
      .map((capability) => `output:${capability}`));
    if (
      stage.id === 'tender-document-analysis'
      && documentBatchManifest
      && (documentBatchManifest.completedBatches !== documentBatchManifest.batchCount || documentBatchManifest.missingDocumentIds.length > 0)
    ) {
      completionMissingItems.push('document-batches:incomplete');
    }
    if (
      stage.id === 'tender-document-analysis'
      && documentBatchManifest
      && documentBatchManifest.completedBatches === documentBatchManifest.batchCount
      && documentBatchManifest.missingDocumentIds.length === 0
    ) {
      completionMissingItems.push(
        ...documentMergeRuntimeErrors.map((error) => `document-merge:${error}`),
        ...validateFinalDocumentAnalysisMerge(paths, documentBatchManifest)
          .map((error) => `document-merge:${error}`),
      );
      const reviewLedger = readDocumentReviewLedger(paths.projectDirectory, project.projectId);
      completionMissingItems.push(
        ...assertDocumentParseGate(
          reviewLedger,
          documentBatchManifest.batches.map((batch) => batch.documentId),
        ),
      );
    }
    if (
      stage.id === 'boq-five-step-pricing'
      && boqBatchManifest
      && (boqBatchManifest.completedBatches !== boqBatchManifest.batchCount || boqBatchManifest.missingItemIds.length > 0)
    ) {
      completionMissingItems.push('boq-batches:incomplete');
    }
    if (
      stage.id === 'boq-five-step-pricing'
      && boqBatchManifest
      && boqBatchManifest.completedBatches === boqBatchManifest.batchCount
      && boqBatchManifest.missingItemIds.length === 0
    ) {
      completionMissingItems.push(
        ...boqMergeRuntimeErrors.map((error) => `boq-merge:${error}`),
        ...validateFinalBoqMerge(paths, boqBatchManifest).map((error) => `boq-merge:${error}`),
        ...resourceScheduleRuntimeErrors.map((error) => `resource-schedule:${error}`),
        ...assertResourceScheduleArtifacts(project.rootPath, project.projectId, paths.projectDirectory),
      );
    }
    if (stage.id === 'planning-and-submission') {
      completionMissingItems.push(
        ...assertPlanningSubstepGate(project.rootPath, paths.projectDirectory, project.projectId),
      );
    }
  }

  const planningSubsteps = stage.id === 'planning-and-submission'
    ? evaluatePlanningSubsteps(project.rootPath, paths.projectDirectory, project.projectId)
    : undefined;

  const missingItems = shouldEvaluateCompletion
    ? [...baseMissingItems, ...completionMissingItems]
    : baseMissingItems;
  const now = new Date().toISOString();
  const status = determineStatus(
    request.action,
    baseMissingItems,
    completionMissingItems,
    previous?.status,
  );
  const stageResult: Omit<TenderStageRunResult, 'sourceBoundary' | 'paths'> = {
    schemaVersion: 1,
    projectId: project.projectId,
    stageId: stage.id,
    status,
    requiredCapabilities: stage.requiredCapabilities,
    producedCapabilities: stage.producedCapabilities,
    generatedPacks,
    missingItems: [...new Set(missingItems)],
    batchProgress: documentBatchManifest
      ? documentBatchProgress(documentBatchManifest, taskBoard)
      : boqBatchManifest
        ? boqBatchProgress(boqBatchManifest, taskBoard)
        : undefined,
    ...(planningSubsteps ? { substeps: planningSubsteps } : {}),
    ...(persisted.migratedFromLegacy || electedMultiParent ? { migratedFromLegacy: true } : {}),
    ...(projectParentSessionId ? { projectParentSessionId } : {}),
    updatedAt: now,
    startedAt: (request.action === 'start' || request.action === 'resume' || request.action === 'advance') && status === 'running'
      ? (previous?.startedAt ?? now)
      : previous?.startedAt,
    completedAt: status === 'complete' ? (previous?.completedAt ?? now) : undefined,
  };
  const nextState: PersistedTenderStageState = {
    ...persisted,
    updatedAt: now,
    stages: { ...persisted.stages, [stage.id]: stageResult },
  };
  atomicWriteJson(paths.stageStatePath, nextState);

  return { ...stageResult, sourceBoundary, paths: publicPaths(paths, taskBoard) };
}

function determineStatus(
  action: TenderStageRunAction,
  baseMissingItems: string[],
  completionMissingItems: string[],
  previous?: TenderStageRunStatus,
): TenderStageRunStatus {
  if (baseMissingItems.length > 0) return 'blocked';
  if (action === 'preflight') return 'ready';
  if (action === 'start' || action === 'resume' || action === 'advance' || action === 'reset_orchestration' || action === 'set_dispatch') {
    return 'running';
  }
  if (action === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  if (previous === 'running') return completionMissingItems.length > 0 ? 'running' : 'complete';
  if (previous === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  return 'ready';
}

function defaultStageConcurrency(stageId: string): number {
  if (stageId === 'tender-document-analysis') return 4;
  if (stageId === 'boq-five-step-pricing') return 4;
  return 1;
}

function loadBoqBatchManifest(
  paths: ReturnType<typeof resolvePaths>,
  projectId: string,
  generatedPacks: TenderCapabilityId[],
  sourceBoundary: TenderSourceBoundary,
  projectRoot: string,
): TenderBoqBatchManifest | undefined {
  if (!generatedPacks.includes('boq_reconciliation')) return undefined;
  const modelPath = join(paths.projectDirectory, 'packs', 'boq-reconciliation.json');
  if (!existsSync(modelPath)) return undefined;
  const envelope = parseTenderCapabilityEnvelope(readJson(modelPath));
  const boq = parseTenderBoqReconciliationData(envelope.data);
  const sourcePathByDocumentId = new Map(
    sourceBoundary.files
      .filter((file) => file.status === 'registered')
      .map((file) => [file.documentId, file.path] as const),
  );
  return createOrRefreshBoqBatchManifest(
    paths.projectDirectory,
    projectId,
    boq,
    sourcePathByDocumentId,
    { projectRoot },
  );
}

function listReadyPacks(index: TenderCapabilityIndex): TenderCapabilityId[] {
  return index.capabilities
    .filter((entry) => entry.revision > 0 && entry.readiness === 'ready' && !entry.stale)
    .map((entry) => entry.capability);
}

function listSatisfiedPacks(
  index: TenderCapabilityIndex,
  paths: ReturnType<typeof resolvePaths>,
  documentManifest?: TenderDocumentAnalysisBatchManifest,
  boqManifest?: TenderBoqBatchManifest,
): TenderCapabilityId[] {
  const ready = listReadyPacks(index);
  const satisfied = [...ready];
  if (
    documentManifest
    && isCapabilitySatisfied('document_analysis', index, paths, documentManifest, boqManifest)
    && !satisfied.includes('document_analysis')
  ) {
    satisfied.push('document_analysis');
  }
  if (
    boqManifest
    && isCapabilitySatisfied('boq_five_step_pricing', index, paths, documentManifest, boqManifest)
    && !satisfied.includes('boq_five_step_pricing')
  ) {
    satisfied.push('boq_five_step_pricing');
  }
  if (
    isCapabilitySatisfied('construction_resource_schedule', index, paths, documentManifest, boqManifest)
    && !satisfied.includes('construction_resource_schedule')
  ) {
    satisfied.push('construction_resource_schedule');
  }
  return satisfied;
}

function isCapabilitySatisfied(
  capability: TenderCapabilityId,
  index: TenderCapabilityIndex,
  paths: ReturnType<typeof resolvePaths>,
  documentManifest?: TenderDocumentAnalysisBatchManifest,
  boqManifest?: TenderBoqBatchManifest,
): boolean {
  const entry = index.capabilities.find((candidate) => candidate.capability === capability);
  if (!entry || entry.revision <= 0 || entry.stale) return false;
  if (entry.readiness === 'ready') return true;
  // Deterministic merges may land as needs_review when some child records are
  // still draft; accept them once the pack exists and matches the merge.
  if (entry.readiness === 'needs_review') {
    if (
      capability === 'document_analysis'
      && documentManifest
      && validateFinalDocumentAnalysisMerge(paths, documentManifest).length === 0
    ) {
      return true;
    }
    if (
      capability === 'boq_five_step_pricing'
      && boqManifest
      && boqManifest.batchCount > 0
      && boqManifest.completedBatches === boqManifest.batchCount
      && boqManifest.missingItemIds.length === 0
      && validateFinalBoqMerge(paths, boqManifest).length === 0
    ) {
      return true;
    }
    if (
      capability === 'construction_resource_schedule'
      && existsSync(join(paths.projectDirectory, 'packs', 'construction-resource-schedule.json'))
    ) {
      return true;
    }
  }
  return false;
}

async function ensureResourceSchedulePack(input: {
  context: SessionToolContext;
  paths: ReturnType<typeof resolvePaths>;
  projectId: string;
  projectRoot: string;
}): Promise<{ errors: string[] }> {
  const pricingPackPath = join(input.paths.projectDirectory, 'packs', 'boq-five-step-pricing.json');
  const artifacts = writeConstructionResourceScheduleArtifacts({
    projectRoot: input.projectRoot,
    projectId: input.projectId,
    pricingPackPath,
  });
  if ('errors' in artifacts) return { errors: artifacts.errors };

  const packPath = join(input.paths.projectDirectory, 'packs', 'construction-resource-schedule.json');
  const action = existsSync(packPath) ? 'replace' : 'init';
  const result = await handleTenderCapability(input.context, {
    action,
    projectId: input.projectId,
    capability: 'construction_resource_schedule',
    data: artifacts.data,
  });
  if (result.isError) {
    return {
      errors: [
        result.content.map((block) => block.text).join('\n')
          || 'construction_resource_schedule pack write failed',
      ],
    };
  }
  return { errors: [] };
}

async function ensureDocumentAnalysisPackMerged(input: {
  context: SessionToolContext;
  paths: ReturnType<typeof resolvePaths>;
  projectId: string;
  workingDirectory: string;
  manifest: TenderDocumentAnalysisBatchManifest;
  parentSessionId?: string;
}): Promise<{ errors: string[] }> {
  const packPath = join(input.paths.projectDirectory, 'packs', 'document-analysis.json');
  const existingMergeErrors = existsSync(packPath)
    ? validateFinalDocumentAnalysisMerge(input.paths, input.manifest)
    : ['missing'];
  const merged = mergeDocumentAnalysisBatchReports(input.manifest);
  if (merged.errors.length > 0) return { errors: merged.errors };

  if (existingMergeErrors.length === 0) {
    // Pack already matches child reports — still refresh the formal MD summary.
    if (input.parentSessionId) {
      writeDocumentAnalysisSummaryMarkdown(merged.data, {
        projectId: input.projectId,
        parentSessionId: input.parentSessionId,
        workingDirectory: input.workingDirectory,
        manifest: input.manifest,
      });
    }
    return { errors: [] };
  }

  const action = existsSync(packPath) ? 'replace' : 'init';
  // Omit inline data — tender_capability syncs from batch reports when complete.
  const result = await handleTenderCapability(input.context, {
    action,
    projectId: input.projectId,
    capability: 'document_analysis',
  });
  if (result.isError) {
    return {
      errors: [result.content.map((block) => block.text).join('\n') || 'document_analysis merge write failed'],
    };
  }

  if (input.parentSessionId) {
    writeDocumentAnalysisSummaryMarkdown(merged.data, {
      projectId: input.projectId,
      parentSessionId: input.parentSessionId,
      workingDirectory: input.workingDirectory,
      manifest: input.manifest,
    });
  }
  return { errors: [] };
}

function validateFinalDocumentAnalysisMerge(
  paths: ReturnType<typeof resolvePaths>,
  manifest: TenderDocumentAnalysisBatchManifest,
): string[] {
  return validateFinalPack(
    join(paths.projectDirectory, 'packs', 'document-analysis.json'),
    (data) => validateDocumentAnalysisBatchMerge(manifest, data),
  );
}

async function ensureBoqPackMerged(input: {
  context: SessionToolContext;
  paths: ReturnType<typeof resolvePaths>;
  projectId: string;
  manifest: TenderBoqBatchManifest;
  workspace: TenderWorkspace;
}): Promise<{ errors: string[] }> {
  const packPath = join(input.paths.projectDirectory, 'packs', 'boq-five-step-pricing.json');
  const existingMergeErrors = existsSync(packPath)
    ? validateFinalBoqMerge(input.paths, input.manifest)
    : ['missing'];
  const currency = /^[A-Z]{3}$/.test(input.workspace.project.currency ?? '')
    ? input.workspace.project.currency!
    : 'USD';
  const merged = mergeBoqBatchReports(input.manifest.batches, currency);
  if (merged.errors.length > 0 || !merged.data) return { errors: merged.errors };
  if (existingMergeErrors.length === 0) return { errors: [] };

  const action = existsSync(packPath) ? 'replace' : 'init';
  // Omit inline data — tender_capability syncs from batch reports when complete.
  const result = await handleTenderCapability(input.context, {
    action,
    projectId: input.projectId,
    capability: 'boq_five_step_pricing',
  });
  if (result.isError) {
    return {
      errors: [result.content.map((block) => block.text).join('\n') || 'boq_five_step_pricing merge write failed'],
    };
  }
  return { errors: [] };
}

function latestLegacyStageState(
  persisted: PersistedTenderStageState,
  canonicalId: string,
): Omit<TenderStageRunResult, 'sourceBoundary' | 'paths'> | undefined {
  const legacyIds = Object.entries(STAGE_ALIASES)
    .filter(([, canonical]) => canonical === canonicalId)
    .map(([legacy]) => legacy);
  let latest: Omit<TenderStageRunResult, 'sourceBoundary' | 'paths'> | undefined;
  for (const legacyId of legacyIds) {
    const candidate = persisted.stages[legacyId];
    if (candidate && (!latest || candidate.updatedAt > latest.updatedAt)) latest = candidate;
  }
  return latest;
}

function validateFinalBoqMerge(
  paths: ReturnType<typeof resolvePaths>,
  manifest: TenderBoqBatchManifest,
): string[] {
  return validateFinalPack(
    join(paths.projectDirectory, 'packs', 'boq-five-step-pricing.json'),
    (data) => validateBoqBatchMerge(manifest, data),
  );
}

function validateFinalPack(filePath: string, validate: (data: unknown) => string[]): string[] {
  if (!existsSync(filePath)) return [`final capability pack is missing: ${filePath}`];
  try {
    return validate(parseTenderCapabilityEnvelope(readJson(filePath)).data);
  } catch (error) {
    return [`final capability pack is invalid: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function documentBatchProgress(
  manifest: TenderDocumentAnalysisBatchManifest,
  taskBoard?: TenderStageTaskBoard,
): NonNullable<TenderStageRunResult['batchProgress']> {
  return {
    batchType: 'document_analysis',
    itemCount: manifest.documentCount,
    batchCount: manifest.batchCount,
    completedBatches: manifest.completedBatches,
    missingItemCount: manifest.missingDocumentIds.length,
    manifestPath: manifest.manifestPath,
    ...taskBoardProgress(taskBoard),
    invalidBatches: manifest.batches
      .filter((batch) => batch.status === 'invalid')
      .map((batch) => ({ batchId: batch.batchId, errors: batch.validationErrors.slice(0, 3) })),
  };
}

function boqBatchProgress(
  manifest: TenderBoqBatchManifest,
  taskBoard?: TenderStageTaskBoard,
): NonNullable<TenderStageRunResult['batchProgress']> {
  return {
    batchType: 'boq_five_step_pricing',
    itemCount: manifest.itemCount,
    batchCount: manifest.batchCount,
    completedBatches: manifest.completedBatches,
    missingItemCount: manifest.missingItemIds.length,
    manifestPath: manifest.manifestPath,
    ...taskBoardProgress(taskBoard),
    invalidBatches: manifest.batches
      .filter((batch) => batch.status === 'invalid')
      .map((batch) => ({ batchId: batch.batchId, errors: batch.validationErrors.slice(0, 3) })),
    validationWarningCount: manifest.batches.reduce((sum, batch) => sum + (batch.validationWarnings?.length ?? 0), 0),
    skippedItems: manifest.skippedItems ?? [],
  };
}

function taskBoardProgress(taskBoard?: TenderStageTaskBoard) {
  const tasks = taskBoard?.tasks ?? [];
  return {
    taskBoardPath: taskBoard?.taskBoardPath,
    parentSessionId: taskBoard?.parentSessionId,
    pendingBatches: tasks.filter((task) => task.status === 'pending').length,
    runningBatches: tasks.filter((task) => task.status === 'running').length,
    failedBatches: tasks.filter((task) => task.status === 'failed').length,
    blockedBatches: tasks.filter((task) => task.status === 'blocked').length,
    tasks,
  };
}

function buildBatchTaskSpecs(
  documentManifest: TenderDocumentAnalysisBatchManifest | undefined,
  boqManifest: TenderBoqBatchManifest | undefined,
  sourceBoundary: TenderSourceBoundary,
): TenderStageBatchTaskSpec[] | undefined {
  if (documentManifest) {
    return documentManifest.batches.map((batch) => ({
      batchId: batch.batchId,
      briefPath: batch.briefPath,
      reportPath: batch.reportPath,
      markdownPath: batch.markdownPath,
      allowedSourcePaths: [batch.sourcePath],
      validationStatus: batch.status,
      validationErrors: batch.validationErrors,
      name: `Tender document analysis · ${basename(batch.sourcePath)}`,
    }));
  }
  if (!boqManifest) return undefined;
  const sourcePathById = new Map(
    sourceBoundary.files
      .filter((file) => file.status === 'registered')
      .map((file) => [file.documentId, file.path] as const),
  );
  return boqManifest.batches.map((batch) => ({
    batchId: batch.batchId,
    briefPath: batch.briefPath,
    reportPath: batch.reportPath,
    markdownPath: batch.markdownPath,
    allowedSourcePaths: batch.allowedDocumentIds
      .map((documentId) => sourcePathById.get(documentId))
      .filter((path): path is string => Boolean(path)),
    validationStatus: batch.status,
    validationErrors: batch.validationErrors,
    name: `BOQ five-step pricing · ${batch.source.sheet} · ${batch.batchId}`,
  }));
}

async function syncSourceBoundary(
  context: SessionToolContext,
  paths: ReturnType<typeof resolvePaths>,
  project: ReturnType<typeof listBusinessProjects>[number],
): Promise<TenderSourceBoundary> {
  mkdirSync(paths.projectDirectory, { recursive: true });
  const files: TenderSourceBoundaryFile[] = [];
  for (let index = 0; index < project.inputPaths.length; index += 1) {
    const path = project.inputPaths[index]!;
    const name = basename(path);
    if (!existsSync(path)) {
      files.push({ documentId: sourceDocumentId(path), path, name, kind: inferDocumentKind(path), priority: index + 1, status: 'missing' });
    } else {
      const stat = statSync(path);
      if (!stat.isFile()) {
        files.push({ documentId: sourceDocumentId(path), path, name, kind: inferDocumentKind(path), priority: index + 1, status: 'unsupported' });
      } else {
        files.push({
          documentId: sourceDocumentId(path),
          path,
          name,
          kind: inferDocumentKind(path),
          priority: index + 1,
          status: 'registered',
          sizeBytes: stat.size,
        });
      }
    }
    if (index > 0 && index % 5 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const previousBoundary = existsSync(paths.sourceBoundaryPath)
    ? readJson(paths.sourceBoundaryPath) as unknown as TenderSourceBoundary
    : undefined;
  const boundary: TenderSourceBoundary = {
    schemaVersion: 1,
    projectId: project.projectId,
    generatedAt: previousBoundary
      && previousBoundary.projectId === project.projectId
      && JSON.stringify(previousBoundary.files) === JSON.stringify(files)
      ? previousBoundary.generatedAt
      : new Date().toISOString(),
    files,
    registeredCount: files.filter((file) => file.status === 'registered').length,
    missingPaths: files.filter((file) => file.status !== 'registered').map((file) => file.path),
  };
  const boundaryUnchanged = previousBoundary
    && previousBoundary.projectId === boundary.projectId
    && previousBoundary.registeredCount === boundary.registeredCount
    && JSON.stringify(previousBoundary.files) === JSON.stringify(boundary.files)
    && JSON.stringify(previousBoundary.missingPaths) === JSON.stringify(boundary.missingPaths);
  if (!boundaryUnchanged) {
    atomicWriteJson(paths.sourceBoundaryPath, boundary);
  }

  if (!existsSync(paths.workspacePath)) {
    const initialized = await handleTenderWorkspace(context, {
      action: 'init',
      projectId: project.projectId,
      project: { id: project.projectId, title: project.name, status: 'active' },
    });
    assertToolSuccess(initialized);
  }
  const workspace = parseTenderWorkspace(readJson(paths.workspacePath));
  const currentDocumentById = new Map(workspace.documents.map((document) => [document.id, document]));
  const registeredDocuments: TenderDocument[] = files
    .filter((file) => file.status === 'registered')
    .map((file) => ({
      id: file.documentId,
      name: file.name,
      path: file.path,
      kind: file.kind,
      status: 'active',
    }));
  const currentBoundaryIds = new Set(registeredDocuments.map((document) => document.id));
  const withdrawnDocuments: TenderDocument[] = (previousBoundary?.files ?? [])
    .filter((file) => file.status === 'registered' && !currentBoundaryIds.has(file.documentId))
    .flatMap((file) => {
      const existing = currentDocumentById.get(file.documentId);
      return existing ? [{ ...existing, status: 'withdrawn' as const }] : [];
    });
  const incoming = [...registeredDocuments, ...withdrawnDocuments];
  if (incoming.length > 0 && documentsChanged(workspace, incoming)) {
    const updated = await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: project.projectId,
      documents: incoming,
    });
    assertToolSuccess(updated);
  }
  return boundary;
}

function documentsChanged(workspace: TenderWorkspace, incoming: TenderDocument[]): boolean {
  const current = new Map(workspace.documents.map((document) => [document.id, document]));
  return incoming.some((document) => JSON.stringify(current.get(document.id)) !== JSON.stringify(document));
}

function sourceDocumentId(path: string): string {
  const stem = basename(path, extname(path)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source';
  const hash = createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 12);
  return `src-${stem.slice(0, 58)}-${hash}`;
}

function inferDocumentKind(path: string): TenderDocumentKind {
  const name = basename(path).toLowerCase();
  if (/\bboq\b|bill[ _-]*of[ _-]*quantit|pricing[ _-]*schedule/.test(name)) return 'boq';
  if (/drawing|\bdwg\b|layout|plan[ _-]*sheet/.test(name)) return 'drawing';
  if (/specification|\bspec\b|coto|colto/.test(name)) return 'specification';
  if (/addendum|clarification|bulletin|corrigendum/.test(name)) return 'addendum';
  if (/contract|conditions[ _-]*of[ _-]*contract/.test(name)) return 'contract_data';
  if (/returnable|return[ _-]*schedule/.test(name)) return 'returnable_schedule';
  if (/template|proforma/.test(name)) return 'template';
  if (/tender|bid[ _-]*data|request[ _-]*for[ _-]*proposal|\brfp\b/.test(name)) return 'tender_data';
  return 'other';
}

function createContext(workingDirectory: string): SessionToolContext {
  return {
    sessionId: 'tender-stage-run',
    workspacePath: workingDirectory,
    sourcesPath: join(workingDirectory, '.agent-pi', 'sources'),
    skillsPath: join(workingDirectory, '.agent-pi', 'skills'),
    plansFolderPath: join(workingDirectory, '.agent-pi', 'plans'),
    workingDirectory,
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: createNodeFileSystem(),
    loadSourceConfig: () => null,
  };
}

function resolvePaths(rootPath: string, projectId: string) {
  const projectDirectory = join(rootPath, '.agent-pi', 'business', 'tender', projectId);
  return {
    projectDirectory,
    workspacePath: join(projectDirectory, 'tender-workspace.json'),
    capabilityIndexPath: join(projectDirectory, 'capability-index.json'),
    sourceBoundaryPath: join(projectDirectory, 'source-boundary.json'),
    stageStatePath: join(projectDirectory, 'stage-state.json'),
    documentAnalysisBatchManifestPath: join(projectDirectory, 'document-analysis-batch-manifest.json'),
    boqBatchManifestPath: join(projectDirectory, 'boq-batch-manifest.json'),
  };
}

function publicPaths(
  paths: ReturnType<typeof resolvePaths>,
  taskBoard?: TenderStageTaskBoard,
): TenderStageRunResult['paths'] {
  return {
    projectDirectory: paths.projectDirectory,
    workspacePath: paths.workspacePath,
    sourceBoundaryPath: paths.sourceBoundaryPath,
    stageStatePath: paths.stageStatePath,
    documentAnalysisBatchManifestPath: existsSync(paths.documentAnalysisBatchManifestPath) ? paths.documentAnalysisBatchManifestPath : undefined,
    boqBatchManifestPath: existsSync(paths.boqBatchManifestPath) ? paths.boqBatchManifestPath : undefined,
    taskBoardPath: taskBoard?.taskBoardPath,
  };
}

function readStageState(filePath: string, projectId: string): PersistedTenderStageState {
  if (!existsSync(filePath)) return { schemaVersion: 1, projectId, updatedAt: new Date(0).toISOString(), stages: {} };
  const raw = readJson(filePath) as unknown as PersistedTenderStageState;
  const migrated = migrateTenderStageState({
    schemaVersion: 1,
    projectId: raw.projectId || projectId,
    updatedAt: raw.updatedAt || new Date(0).toISOString(),
    stages: raw.stages ?? {},
    ...(raw.migratedFromLegacy ? { migratedFromLegacy: true } : {}),
  });
  return {
    schemaVersion: 1,
    projectId: migrated.projectId,
    updatedAt: migrated.updatedAt,
    stages: migrated.stages as PersistedTenderStageState['stages'],
    ...(migrated.migratedFromLegacy ? { migratedFromLegacy: true } : {}),
  };
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function assertToolSuccess(result: { isError?: boolean; content: Array<{ text?: string }> }): void {
  if (result.isError) throw new Error(result.content.map((block) => block.text).join('\n'));
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}
