import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { listBusinessProjects } from '@craft-agent/shared/business-projects';
import {
  createNodeFileSystem,
  handleTenderWorkspace,
  type SessionToolContext,
} from '@craft-agent/session-tools-core';
import {
  parseTenderCapabilityIndex,
  parseTenderCapabilityEnvelope,
  parseTenderBoqReconciliationData,
  parseTenderWorkspace,
  type TenderCapabilityId,
  type TenderDocument,
  type TenderDocumentKind,
  type TenderWorkspace,
} from '@agent-pi/business-core/tender';
import {
  createOrRefreshBoqBatchManifest,
  validateBoqBatchMerge,
  type TenderBoqBatchManifest,
} from './tender-boq-batches.ts';
import {
  createOrRefreshDocumentAnalysisBatchManifest,
  validateDocumentAnalysisBatchMerge,
  type TenderDocumentAnalysisBatchManifest,
} from './tender-document-batches.ts';
import {
  updateTenderStageTaskBoard,
  type TenderStageBatchTaskSpec,
  type TenderStageExecutionRuntime,
  type TenderStageTaskBoard,
  type TenderStageTaskRecord,
} from './tender-stage-executor.ts';

export type TenderStageRunAction = 'preflight' | 'start' | 'status' | 'complete';
export type TenderStageRunStatus = 'blocked' | 'ready' | 'running' | 'complete';

export interface TenderStageRunRequest {
  action: TenderStageRunAction;
  workspaceRootPath: string;
  projectId: string;
  stageId: string;
  parentSessionId?: string;
}

export interface TenderStageRunOptions {
  execution?: TenderStageExecutionRuntime;
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
  };
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
}

const STAGES: TenderStageDefinition[] = [
  { id: 'project-setup', requiredCapabilities: [], producedCapabilities: [] },
  {
    id: 'tender-document-analysis',
    requiredCapabilities: [],
    producedCapabilities: ['document_analysis', 'evaluation_strategy', 'boq_reconciliation'],
  },
  {
    id: 'boq-five-step-pricing',
    requiredCapabilities: ['document_analysis', 'boq_reconciliation'],
    producedCapabilities: ['boq_five_step_pricing'],
  },
  {
    id: 'work-plan-methodology',
    requiredCapabilities: ['document_analysis', 'boq_reconciliation', 'boq_five_step_pricing'],
    producedCapabilities: ['execution_plan'],
  },
  {
    id: 'schedule-resource-planning',
    requiredCapabilities: ['execution_plan', 'boq_five_step_pricing'],
    producedCapabilities: ['schedule_resources'],
  },
  {
    id: 'cost-cashflow-planning',
    requiredCapabilities: ['boq_reconciliation', 'boq_five_step_pricing', 'schedule_resources'],
    producedCapabilities: ['cost_cashflow'],
  },
  {
    id: 'tender-submission-documents',
    requiredCapabilities: ['execution_plan', 'schedule_resources', 'cost_cashflow'],
    producedCapabilities: ['submission_documents'],
  },
  {
    id: 'submission-audit',
    requiredCapabilities: ['submission_documents'],
    producedCapabilities: ['submission_audit'],
  },
];

export async function runTenderStage(
  request: TenderStageRunRequest,
  options: TenderStageRunOptions = {},
): Promise<TenderStageRunResult> {
  const project = listBusinessProjects(request.workspaceRootPath, 'tender')
    .find((candidate) => candidate.projectId === request.projectId);
  if (!project) throw new Error(`Tender Business Project ${request.projectId} does not exist.`);
  const stage = STAGES.find((candidate) => candidate.id === request.stageId);
  if (!stage) throw new Error(`Unknown tender stage: ${request.stageId}`);

  const paths = resolvePaths(project.rootPath, project.projectId);
  const context = createContext(project.rootPath);
  const sourceBoundary = await syncSourceBoundary(context, paths, project);
  const capabilityIndex = existsSync(paths.capabilityIndexPath)
    ? parseTenderCapabilityIndex(readJson(paths.capabilityIndexPath))
    : { schemaVersion: 1 as const, projectId: project.projectId, coreRevision: 0, capabilities: [] };
  const generatedPacks = capabilityIndex.capabilities
    .filter((entry) => entry.revision > 0 && entry.readiness === 'ready' && !entry.stale)
    .map((entry) => entry.capability);
  const documentBatchManifest = stage.id === 'tender-document-analysis'
    ? createOrRefreshDocumentAnalysisBatchManifest(
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
      )
    : undefined;
  const boqBatchManifest = stage.id === 'boq-five-step-pricing'
    ? loadBoqBatchManifest(paths, project.projectId, generatedPacks, sourceBoundary)
    : undefined;
  const batchTaskSpecs = buildBatchTaskSpecs(documentBatchManifest, boqBatchManifest, sourceBoundary);
  const taskBoard = batchTaskSpecs
    ? await updateTenderStageTaskBoard({
        action: request.action,
        projectDirectory: paths.projectDirectory,
        projectId: project.projectId,
        stageId: stage.id,
        workingDirectory: project.rootPath,
        parentSessionId: request.parentSessionId,
        tasks: batchTaskSpecs,
        execution: options.execution,
      })
    : undefined;
  const persisted = readStageState(paths.stageStatePath, project.projectId);
  const previous = persisted.stages[stage.id];
  const baseMissingItems = [
    ...sourceBoundary.missingPaths.map((path) => `source:${path}`),
    ...(sourceBoundary.registeredCount === 0 ? ['source:registered-file-required'] : []),
    ...stage.requiredCapabilities
      .filter((capability) => !generatedPacks.includes(capability))
      .map((capability) => `capability:${capability}`),
  ];
  if (stage.id === 'tender-document-analysis') {
    if (!documentBatchManifest) baseMissingItems.push('document-batches:manifest-unavailable');
    else if (documentBatchManifest.documentCount === 0) baseMissingItems.push('document-batches:no-documents');
  }
  if (stage.id === 'boq-five-step-pricing') {
    if (!boqBatchManifest) baseMissingItems.push('boq-batches:manifest-unavailable');
    else if (boqBatchManifest.itemCount === 0) baseMissingItems.push('boq-batches:no-items');
  }
  if (taskBoard && options.execution && request.action === 'start' && !taskBoard.parentSessionId) {
    baseMissingItems.push('task-board:parent-session-required');
  }
  if (taskBoard) {
    const failedTasks = taskBoard.tasks.filter((task) => task.status === 'failed').length;
    const blockedTasks = taskBoard.tasks.filter((task) => task.status === 'blocked').length;
    if (failedTasks > 0) baseMissingItems.push(`task-board:failed:${failedTasks}`);
    if (blockedTasks > 0) baseMissingItems.push(`task-board:blocked:${blockedTasks}`);
  }
  const shouldEvaluateCompletion = request.action === 'complete'
    || (request.action === 'status' && (previous?.status === 'running' || previous?.status === 'complete'));
  const completionMissingItems: string[] = [];
  if (shouldEvaluateCompletion) {
    completionMissingItems.push(...stage.producedCapabilities
      .filter((capability) => !generatedPacks.includes(capability))
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
      && generatedPacks.includes('document_analysis')
    ) {
      completionMissingItems.push(...validateFinalDocumentAnalysisMerge(paths, documentBatchManifest)
        .map((error) => `document-merge:${error}`));
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
      && generatedPacks.includes('boq_five_step_pricing')
    ) {
      completionMissingItems.push(...validateFinalBoqMerge(paths, boqBatchManifest)
        .map((error) => `boq-merge:${error}`));
    }
  }

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
    updatedAt: now,
    startedAt: request.action === 'start' && status === 'running' ? (previous?.startedAt ?? now) : previous?.startedAt,
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
  if (action === 'start') return 'running';
  if (action === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  if (previous === 'running') return completionMissingItems.length > 0 ? 'running' : 'complete';
  if (previous === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  return 'ready';
}

function loadBoqBatchManifest(
  paths: ReturnType<typeof resolvePaths>,
  projectId: string,
  generatedPacks: TenderCapabilityId[],
  sourceBoundary: TenderSourceBoundary,
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
  return createOrRefreshBoqBatchManifest(paths.projectDirectory, projectId, boq, sourcePathByDocumentId);
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
  const files: TenderSourceBoundaryFile[] = project.inputPaths.map((path, index) => {
    const name = basename(path);
    if (!existsSync(path)) {
      return { documentId: sourceDocumentId(path), path, name, kind: inferDocumentKind(path), priority: index + 1, status: 'missing' };
    }
    const stat = statSync(path);
    if (!stat.isFile()) {
      return { documentId: sourceDocumentId(path), path, name, kind: inferDocumentKind(path), priority: index + 1, status: 'unsupported' };
    }
    return {
      documentId: sourceDocumentId(path),
      path,
      name,
      kind: inferDocumentKind(path),
      priority: index + 1,
      status: 'registered',
      sizeBytes: stat.size,
    };
  });
  const boundary: TenderSourceBoundary = {
    schemaVersion: 1,
    projectId: project.projectId,
    generatedAt: new Date().toISOString(),
    files,
    registeredCount: files.filter((file) => file.status === 'registered').length,
    missingPaths: files.filter((file) => file.status !== 'registered').map((file) => file.path),
  };
  const previousBoundary = existsSync(paths.sourceBoundaryPath)
    ? readJson(paths.sourceBoundaryPath) as unknown as TenderSourceBoundary
    : undefined;
  atomicWriteJson(paths.sourceBoundaryPath, boundary);

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
  return readJson(filePath) as unknown as PersistedTenderStageState;
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
