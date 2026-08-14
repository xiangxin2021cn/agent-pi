import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { listBusinessProjects } from '@craft-agent/shared/business-projects/storage';
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
  type TenderProjectBoundarySource,
  type TenderWorkspace,
} from '@agent-pi/business-core/tender';
import {
  createOrRefreshBoqBatchManifest,
  validateBoqBatchMerge,
  type TenderBoqBatchManifest,
} from './tender-boq-batches.ts';
import {
  publishDocumentAnalysisArtifactsToOfficialOutputs,
  writeDocumentAnalysisSummaryMarkdown,
} from './tender-document-analysis-md.ts';
import { publishBoqPricingOfficialOutputs } from './tender-boq-pricing-md.ts';
import {
  buildStageDeliverablesCatalog,
  organizeStageDeliverables,
  stageDeliverablesCatalogPath,
  type OrganizeStageDeliverablesResult,
} from './tender-stage-deliverables.ts';
import { ensureDefaultTenderBindings, applyTenderProfileBindings } from './tender-bindings.ts';
import {
  suggestProjectBoundaryDraftFromBindings,
  publishProjectBoundaryMarkdown,
  readProjectBoundaryPack,
  applyBoundarySourcesToPack,
} from './tender-project-boundary.ts';
import {
  readBoundarySourceRegistry,
  writeBoundarySourceRegistry,
  type TenderBoundarySourceInput,
} from './tender-boundary-sources.ts';
import {
  createOrRefreshBoundaryBatchManifest,
  mergeBoundaryParseReports,
  type TenderBoundaryBatchManifest,
} from './tender-boundary-batches.ts';
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
  writeConstructionResourceScheduleArtifacts,
} from './tender-resource-schedule.ts';
import {
  updateTenderStageTaskBoard,
  type TenderStageBatchTaskSpec,
  type TenderStageBoardAction,
  type TenderStageExecutionRuntime,
  type TenderStageTaskBoard,
  type TenderStageTaskRecord,
} from './tender-stage-executor.ts';
import {
  PROJECT_CHARACTERISTICS_EVIDENCE_GATE,
  authorizeProjectCharacteristicsWebDiligence,
  projectCharacteristicsEvidenceMissingItems,
  resolveLiveProjectCharacteristicsEvidence,
  toProjectCharacteristicsEvidenceDto,
  type ProjectCharacteristicsEvidenceLedger,
} from './tender-project-characteristics-evidence.ts';

export type TenderStageRunAction =
  | 'preflight'
  | 'start'
  | 'status'
  | 'resume'
  | 'advance'
  | 'complete'
  | 'reset_orchestration'
  | 'set_dispatch'
  | 'organize_deliverables'
  | 'suggest_project_boundary'
  | 'save_project_boundary'
  | 'register_boundary_sources'
  | 'force_pass';
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
  /** Pack data for `save_project_boundary`. */
  projectBoundaryData?: Record<string, unknown>;
  /** Full replace of boundary fence sources. */
  boundarySources?: TenderBoundarySourceInput[];
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
  /** User-waived missing-item gates; status ignores these items. */
  userForcePass?: { at: string; waivedItems: string[] };
  /** Project-characteristic evidence gaps; BOQ/planning must not invent missing facts. */
  characteristicsEvidence?: {
    blocking: boolean;
    webDiligenceAuthorized: boolean;
    evidenceFileNames: string[];
    gaps: Array<{
      chapterId: string;
      title: string;
      blocking: boolean;
      detail: string;
      suggestedUpload: string;
    }>;
  };
  batchProgress?: {
    batchType: 'document_analysis' | 'boq_five_step_pricing' | 'project_boundary';
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
  boundaryDesk?: {
    sources: Array<{
      id: string;
      kind: string;
      role: string;
      title: string;
      path?: string;
      knowledgeSlug?: string;
      documentId?: string;
      markdownPath?: string;
      parseStatus: string;
    }>;
    suggestedSpecs: Array<{ documentId: string; title: string; path: string; kind: string }>;
  };
  /** Visible 4-A / 4-B / 4-C checklist for planning-and-submission. */
  substeps?: PlanningSubstepState[];
  /** True when stage-state.json still carries folded V2.4 legacy keys. */
  migratedFromLegacy?: boolean;
  /** Single project-lifetime parent session shared across stages. */
  projectParentSessionId?: string;
  deliverables?: {
    catalogPath: string;
    presentCount: number;
    missingCount: number;
    thinCount: number;
    publishedToOfficial: boolean;
    summaryPath?: string;
    indexLines: string[];
    healed?: number;
    published?: number;
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
    stageDeliverablesCatalogPath?: string;
    boundaryBatchManifestPath?: string;
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

// Soft stage gates: enter next stage when the prior stage has usable primary results.
// Secondary packs stay best-effort and must not hard-block handoff.
const STAGES: TenderStageDefinition[] = [
  { id: 'project-setup', requiredCapabilities: [], producedCapabilities: [] },
  {
    id: 'tender-document-analysis',
    requiredCapabilities: [],
    producedCapabilities: ['document_analysis', 'boq_reconciliation'],
  },
  {
    // Hidden from the workbench UI; kept so leftover RPC/old sessions still resolve.
    id: 'project-boundary-conditions',
    requiredCapabilities: ['document_analysis'],
    producedCapabilities: ['project_boundary'],
  },
  {
    id: 'boq-five-step-pricing',
    requiredCapabilities: ['document_analysis'],
    producedCapabilities: ['boq_five_step_pricing', 'construction_resource_schedule', 'bidder_commitments'],
  },
  {
    id: 'planning-and-submission',
    requiredCapabilities: ['boq_five_step_pricing'],
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
  const readableParentSessionId = boardParentSessionId ?? projectParentSessionId;
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
        { projectRoot: project.rootPath, parentSessionId: readableParentSessionId },
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
      readableParentSessionId,
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
      parentSessionId: readableParentSessionId,
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
      parentSessionId: readableParentSessionId,
    });
  }
  const boqBatchManifest = stage.id === 'boq-five-step-pricing'
    ? loadBoqBatchManifest(paths, project.projectId, generatedPacks, sourceBoundary, project.rootPath, readableParentSessionId)
    : undefined;

  if (request.action === 'register_boundary_sources' && Array.isArray(request.boundarySources)) {
    const registry = writeBoundarySourceRegistry(
      paths.projectDirectory,
      project.projectId,
      request.boundarySources,
    );
    const existingPack = readProjectBoundaryPack(paths.projectDirectory);
    if (existingPack) {
      const patched = applyBoundarySourcesToPack(existingPack.data, registry.sources);
      const result = await handleTenderCapability(context, {
        action: 'replace',
        projectId: project.projectId,
        capability: 'project_boundary',
        data: patched,
      });
      if (result.isError) {
        throw new Error(result.content.map((block) => block.text).join('\n'));
      }
    }
  }

  const boundaryRegistry = readBoundarySourceRegistry(paths.projectDirectory, project.projectId);
  const boundaryBatchManifest = stage.id === 'project-boundary-conditions'
    ? createOrRefreshBoundaryBatchManifest(
        paths.projectDirectory,
        project.projectId,
        boundaryRegistry.sources,
        { projectRoot: project.rootPath, parentSessionId: readableParentSessionId },
      )
    : undefined;

  const batchTaskSpecs = buildBatchTaskSpecs(documentBatchManifest, boqBatchManifest, sourceBoundary, boundaryBatchManifest);
  const defaultConcurrency = defaultStageConcurrency(stage.id);
  const taskBoard = batchTaskSpecs
    ? await updateTenderStageTaskBoard({
        action: toTaskBoardAction(request.action),
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

  const deliverablesParentId = taskBoard?.parentSessionId ?? boardParentSessionId ?? projectParentSessionId;
  if (request.action === 'suggest_project_boundary' || request.action === 'save_project_boundary') {
    context.businessContext = {
      module: 'tender',
      projectId: project.projectId,
      workflowId: 'tender-main',
      stageId: 'project-boundary-conditions',
    };

    let data: Record<string, unknown> | undefined = request.projectBoundaryData;
    if (request.action === 'suggest_project_boundary') {
      const suggestion = suggestProjectBoundaryDraftFromBindings({
        projectDirectory: paths.projectDirectory,
        projectId: project.projectId,
      });
      if (!suggestion) {
        const existing = readProjectBoundaryPack(paths.projectDirectory);
        if (existing && deliverablesParentId) {
          publishProjectBoundaryMarkdown({
            projectRoot: project.rootPath,
            parentSessionId: deliverablesParentId,
            pack: existing.data,
          });
        }
      } else {
        data = suggestion.draft as unknown as Record<string, unknown>;
      }
    }

    if (data) {
      const incomingSources = Array.isArray((data as { boundarySources?: unknown }).boundarySources)
        ? (data as { boundarySources: TenderBoundarySourceInput[] }).boundarySources
        : [];
      const registrySources = incomingSources.length > 0
        ? writeBoundarySourceRegistry(paths.projectDirectory, project.projectId, incomingSources).sources
        : readBoundarySourceRegistry(paths.projectDirectory, project.projectId).sources;
      const existingPack = readProjectBoundaryPack(paths.projectDirectory);
      const incomingStandards = (data as { standards?: Record<string, unknown> }).standards;
      const incomingSpecs = incomingStandards && Array.isArray(incomingStandards.technicalSpecs)
        ? incomingStandards.technicalSpecs
        : undefined;
      const confirmed = typeof (data as { humanConfirmedAt?: unknown }).humanConfirmedAt === 'string';
      if (existingPack) {
        const merged: Record<string, unknown> = {
          ...existingPack.data,
          ...data,
          standards: {
            ...existingPack.data.standards,
            ...(incomingStandards ?? {}),
            technicalSpecs: incomingSpecs && incomingSpecs.length > 0
              ? incomingSpecs
              : existingPack.data.standards.technicalSpecs,
          },
          boundarySources: registrySources,
        };
        const inventory = (data as { extractedInventory?: unknown }).extractedInventory
          ?? existingPack.data.extractedInventory;
        if (inventory) merged.extractedInventory = inventory;
        if (!confirmed) delete merged.humanConfirmedAt;
        data = merged;
      } else if (registrySources.length > 0) {
        data = { ...data, boundarySources: registrySources };
      }
      const packPath = join(paths.projectDirectory, 'packs', 'project-boundary.json');
      const action = existsSync(packPath) ? 'replace' : 'init';
      const result = await handleTenderCapability(context, {
        action,
        projectId: project.projectId,
        capability: 'project_boundary',
        data,
      });
      if (result.isError) {
        throw new Error(result.content.map((block) => block.text).join('\n'));
      }
      const profileId = typeof data.profileId === 'string' ? data.profileId.trim() : '';
      if (profileId) {
        try {
          applyTenderProfileBindings(paths.projectDirectory, profileId);
        } catch {
          // Soft: pack save already succeeded; bindings rewrite is best-effort.
        }
      }
      if (deliverablesParentId) {
        const saved = readProjectBoundaryPack(paths.projectDirectory);
        if (saved) {
          publishProjectBoundaryMarkdown({
            projectRoot: project.rootPath,
            parentSessionId: deliverablesParentId,
            pack: saved.data,
          });
        }
      }
      if (existsSync(paths.capabilityIndexPath)) {
        capabilityIndexLive = parseTenderCapabilityIndex(readJson(paths.capabilityIndexPath));
        generatedPacks = listSatisfiedPacks(capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest);
      }
    }
  }

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

  const boundaryMergeRuntimeErrors: string[] = [];
  if (
    stage.id === 'project-boundary-conditions'
    && boundaryBatchManifest
    && boundaryBatchManifest.batchCount > 0
    && boundaryBatchManifest.completedBatches === boundaryBatchManifest.batchCount
    && boundaryBatchManifest.batches.every((batch) => batch.status === 'complete')
  ) {
    const mergeResult = await ensureBoundaryPackMerged({
      context,
      paths,
      projectId: project.projectId,
      workingDirectory: project.rootPath,
      parentSessionId: taskBoard?.parentSessionId ?? request.parentSessionId,
      manifest: boundaryBatchManifest,
      sources: readBoundarySourceRegistry(paths.projectDirectory, project.projectId).sources,
    });
    boundaryMergeRuntimeErrors.push(...mergeResult.errors);
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
    const pricingPackPath = join(paths.projectDirectory, 'packs', 'boq-five-step-pricing.json');
    if (existsSync(pricingPackPath) && packHasUsableContent(pricingPackPath, 'boq_five_step_pricing')) {
      const scheduleResult = await ensureResourceSchedulePack({
        context,
        paths,
        projectId: project.projectId,
        projectRoot: project.rootPath,
        parentSessionId: deliverablesParentId,
      });
      resourceScheduleRuntimeErrors.push(...scheduleResult.errors);
    }
    if (deliverablesParentId) {
      publishBoqPricingOfficialOutputs({
        workingDirectory: project.rootPath,
        projectId: project.projectId,
        projectDirectory: paths.projectDirectory,
        parentSessionId: deliverablesParentId,
        manifest: boqBatchManifest,
        reviewItems: [
          ...mergeResult.errors,
          ...validateFinalBoqMerge(paths, boqBatchManifest),
        ].filter((item) => isBoqMergeReviewItem(item) || isBoqMergeReviewItem(`boq-merge:${item}`)),
      });
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
  let characteristicsEvidenceLedger: ProjectCharacteristicsEvidenceLedger | undefined;
  if (
    stage.id === 'boq-five-step-pricing'
    || stage.id === 'planning-and-submission'
    || stage.id === 'tender-document-analysis'
  ) {
    characteristicsEvidenceLedger = resolveLiveProjectCharacteristicsEvidence({
      projectDirectory: paths.projectDirectory,
      projectId: project.projectId,
      sourceFiles: sourceBoundary.files,
    });
  }
  if (stage.id === 'boq-five-step-pricing' || stage.id === 'planning-and-submission') {
    baseMissingItems.push(...projectCharacteristicsEvidenceMissingItems(characteristicsEvidenceLedger));
  }
  if (
    stage.id === 'project-boundary-conditions'
    && !isCapabilitySatisfied('project_boundary', capabilityIndexLive, paths, documentBatchManifest, boqBatchManifest)
  ) {
    const suggestion = suggestProjectBoundaryDraftFromBindings({
      projectDirectory: paths.projectDirectory,
      projectId: project.projectId,
    });
    if (suggestion?.source === 'sa-sanral-bindings') {
      baseMissingItems.push('project_boundary:sa-draft-available');
    } else if (suggestion?.source === 'generic') {
      baseMissingItems.push('project_boundary:generic-draft-available');
    }
  }
  if (
    taskBoard
    && options.execution
    && (request.action === 'start' || request.action === 'resume' || request.action === 'advance')
    && !taskBoard.parentSessionId
  ) {
    baseMissingItems.push('task-board:parent-session-required');
  }
  // Soft: failed/blocked children stay visible via batchProgress. They must
  // not hard-block start/resume/advance — that is exactly when the user
  // retries remaining batches.
  const shouldEvaluateCompletion = request.action === 'complete'
    || (
      (request.action === 'status' || request.action === 'resume' || request.action === 'force_pass')
      && (previous?.status === 'running' || previous?.status === 'complete')
    );
  const completionMissingItems: string[] = [];
  if (shouldEvaluateCompletion) {
    // Soft: only the primary produced capability must be present to complete.
    // Secondary packs remain best-effort and should not stall handoff.
    const primaryOutputs: TenderCapabilityId[] = stage.id === 'tender-document-analysis'
      ? ['document_analysis']
      : stage.id === 'project-boundary-conditions'
        ? ['project_boundary']
        : stage.id === 'boq-five-step-pricing'
          ? ['boq_five_step_pricing']
          : stage.id === 'planning-and-submission'
            ? ['execution_plan']
            : stage.producedCapabilities;
    completionMissingItems.push(...primaryOutputs
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
      // Soft: only missing MD artifacts — human review no longer blocks complete.
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
        ...boqMergeRuntimeErrors.filter((error) => !isBoqMergeReviewItem(error)).map((error) => `boq-merge:${error}`),
        ...validateFinalBoqMerge(paths, boqBatchManifest)
          .filter((error) => !isBoqMergeReviewItem(error))
          .map((error) => `boq-merge:${error}`),
        ...resourceScheduleRuntimeErrors.map((error) => `resource-schedule:${error}`),
        // Soft: resource-schedule MD/pack are best-effort after pricing merge.
        // Cross-batch unit/rate conflicts are review items in the stage summary.
      );
    }
    if (
      stage.id === 'project-boundary-conditions'
      && boundaryBatchManifest
      && boundaryBatchManifest.batchCount > 0
      && boundaryBatchManifest.completedBatches !== boundaryBatchManifest.batchCount
    ) {
      completionMissingItems.push('project_boundary:parse-incomplete');
    }
    if (stage.id === 'project-boundary-conditions') {
      completionMissingItems.push(...boundaryMergeRuntimeErrors.map((error) => `project_boundary:merge:${error}`));
      const boundaryPack = readProjectBoundaryPack(paths.projectDirectory);
      if (boundaryPack && !boundaryPack.data.humanConfirmedAt) {
        completionMissingItems.push('project_boundary:unconfirmed');
      }
    }
    if (stage.id === 'planning-and-submission') {
      completionMissingItems.push(
        ...assertPlanningSubstepGate(
          project.rootPath,
          paths.projectDirectory,
          project.projectId,
          deliverablesParentId,
        ),
      );
    }
  }

  const planningSubsteps = stage.id === 'planning-and-submission'
    ? evaluatePlanningSubsteps(
        project.rootPath,
        paths.projectDirectory,
        project.projectId,
        deliverablesParentId,
      )
    : undefined;

  let organizeResult: OrganizeStageDeliverablesResult | undefined;

  if (request.action === 'organize_deliverables') {
    organizeResult = organizeStageDeliverables({
      projectRoot: project.rootPath,
      projectId: project.projectId,
      projectDirectory: paths.projectDirectory,
      stageId: stage.id,
      parentSessionId: deliverablesParentId,
      documentManifest: documentBatchManifest,
      boqManifest: boqBatchManifest,
      boundaryManifest: boundaryBatchManifest,
    });
  }
  const deliverablesCatalog = organizeResult?.catalog ?? buildStageDeliverablesCatalog({
    projectRoot: project.rootPath,
    projectId: project.projectId,
    projectDirectory: paths.projectDirectory,
    stageId: stage.id,
    parentSessionId: deliverablesParentId,
    documentManifest: documentBatchManifest,
    boqManifest: boqBatchManifest,
    boundaryManifest: boundaryBatchManifest,
  });
  // Persist catalog on status polls so handoff always has a path to cite.
  if (request.action === 'status' || request.action === 'organize_deliverables' || request.action === 'complete') {
    try {
      const catalogPath = stageDeliverablesCatalogPath(paths.projectDirectory, stage.id);
      writeJsonIfFingerprintUnchanged(catalogPath, deliverablesCatalog);
    } catch {
      // best-effort catalog persistence
    }
  }

  const missingItems = shouldEvaluateCompletion
    ? [...baseMissingItems, ...completionMissingItems]
    : baseMissingItems;
  const now = new Date().toISOString();
  const previousForcePass = previous?.userForcePass;
  const userForcePass = request.action === 'force_pass'
    ? {
        at: now,
        waivedItems: uniqueUnion(previousForcePass?.waivedItems, baseMissingItems),
      }
    : previousForcePass;
  if (
    request.action === 'force_pass'
    && characteristicsEvidenceLedger
    && baseMissingItems.includes(PROJECT_CHARACTERISTICS_EVIDENCE_GATE)
  ) {
    characteristicsEvidenceLedger = authorizeProjectCharacteristicsWebDiligence({
      projectDirectory: paths.projectDirectory,
      projectId: project.projectId,
      at: now,
      workingDirectory: project.rootPath,
      parentSessionId: deliverablesParentId,
      sourceFiles: sourceBoundary.files,
    });
  }
  const waivedSet = new Set(userForcePass?.waivedItems ?? []);
  const autoRelaxBoundary = shouldAutoRelaxProjectBoundaryGate({
    requiredCapabilities: stage.requiredCapabilities,
    completedBatches: boqBatchManifest?.completedBatches ?? 0,
    previousStatus: previous?.status,
    hasUsableBoqPack: packHasUsableContent(
      capabilityPackPath(paths.projectDirectory, 'boq_five_step_pricing'),
      'boq_five_step_pricing',
    ),
  });
  const relaxedBoundaryItems = autoRelaxBoundary
    ? baseMissingItems.filter(isProjectBoundaryGateItem)
    : [];
  const blockingMissingItems = baseMissingItems.filter((item) => (
    !waivedSet.has(item) && !relaxedBoundaryItems.includes(item)
  ));
  const statusAction: TenderStageRunAction = request.action === 'force_pass' ? 'status' : request.action;
  let status = determineStatus(
    statusAction,
    blockingMissingItems,
    completionMissingItems,
    previous?.status,
  );
  const hasRunningWork = Boolean(taskBoard?.tasks.some((task) => task.status === 'running'));
  if (status !== 'blocked' && hasRunningWork) {
    status = 'running';
  }
  const stageResult: Omit<TenderStageRunResult, 'sourceBoundary' | 'paths'> = {
    schemaVersion: 1,
    projectId: project.projectId,
    stageId: stage.id,
    status: request.action === 'organize_deliverables'
      ? (previous?.status === 'complete' ? 'complete' : status === 'blocked' ? 'blocked' : (previous?.status ?? status))
      : status,
    requiredCapabilities: stage.requiredCapabilities,
    producedCapabilities: stage.producedCapabilities,
    generatedPacks,
    missingItems: [...new Set(missingItems)],
    ...(userForcePass && userForcePass.waivedItems.length > 0 ? { userForcePass } : {}),
    ...(characteristicsEvidenceLedger
      ? { characteristicsEvidence: toProjectCharacteristicsEvidenceDto(characteristicsEvidenceLedger) }
      : {}),
    batchProgress: documentBatchManifest
      ? documentBatchProgress(documentBatchManifest, taskBoard)
      : boqBatchManifest
        ? boqBatchProgress(boqBatchManifest, taskBoard)
        : boundaryBatchManifest
          ? boundaryBatchProgress(boundaryBatchManifest, taskBoard)
          : undefined,
    ...(stage.id === 'project-boundary-conditions' ? {
      boundaryDesk: {
        sources: readBoundarySourceRegistry(paths.projectDirectory, project.projectId).sources,
        suggestedSpecs: sourceBoundary.files
          .filter((file) => file.status === 'registered' && (file.kind === 'specification' || file.kind === 'contract_data'))
          .map((file) => ({
            documentId: file.documentId,
            title: file.name,
            path: file.path,
            kind: file.kind,
          })),
      },
    } : {}),
    ...(planningSubsteps ? { substeps: planningSubsteps } : {}),
    ...(persisted.migratedFromLegacy || electedMultiParent ? { migratedFromLegacy: true } : {}),
    ...(projectParentSessionId ? { projectParentSessionId } : {}),
    deliverables: {
      catalogPath: deliverablesCatalog.catalogPath,
      presentCount: deliverablesCatalog.presentCount,
      missingCount: deliverablesCatalog.missingCount,
      thinCount: deliverablesCatalog.thinCount,
      publishedToOfficial: deliverablesCatalog.publishedToOfficial,
      ...(deliverablesCatalog.summaryPath ? { summaryPath: deliverablesCatalog.summaryPath } : {}),
      indexLines: deliverablesCatalog.indexLines,
      ...(organizeResult ? { healed: organizeResult.healed, published: organizeResult.published } : {}),
    },
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
  writeJsonIfFingerprintUnchanged(paths.stageStatePath, nextState);

  return { ...stageResult, sourceBoundary, paths: publicPaths(paths, taskBoard, stage.id) };
}

function determineStatus(
  action: TenderStageRunAction,
  baseMissingItems: string[],
  completionMissingItems: string[],
  previous?: TenderStageRunStatus,
): TenderStageRunStatus {
  if (baseMissingItems.length > 0) return 'blocked';
  if (action === 'preflight') return 'ready';
  if (
    action === 'start'
    || action === 'resume'
    || action === 'advance'
    || action === 'reset_orchestration'
    || action === 'set_dispatch'
    || action === 'organize_deliverables'
  ) {
    return 'running';
  }
  if (action === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  if (previous === 'running') return completionMissingItems.length > 0 ? 'running' : 'complete';
  if (previous === 'complete') return completionMissingItems.length > 0 ? 'blocked' : 'complete';
  return 'ready';
}

function toTaskBoardAction(action: TenderStageRunAction): TenderStageBoardAction {
  if (
    action === 'force_pass'
    || action === 'suggest_project_boundary'
    || action === 'save_project_boundary'
    || action === 'register_boundary_sources'
    || action === 'organize_deliverables'
  ) {
    return 'status';
  }
  return action as TenderStageBoardAction;
}

function uniqueUnion(existing: string[] | undefined, incoming: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...(existing ?? []), ...incoming]) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function isProjectBoundaryGateItem(item: string): boolean {
  return item === 'capability:project_boundary' || item.startsWith('project_boundary:');
}

function isBoqMergeReviewItem(item: string): boolean {
  const text = item.startsWith('boq-merge:') ? item.slice('boq-merge:'.length) : item;
  return text.startsWith('resource unit conflict')
    || text.startsWith('resource rate conflict')
    || text.startsWith('production basis conflict')
    || text.startsWith('calendar conflict')
    || text.startsWith('final BOQ item differs');
}

function shouldAutoRelaxProjectBoundaryGate(input: {
  requiredCapabilities: TenderCapabilityId[];
  completedBatches: number;
  previousStatus?: TenderStageRunStatus;
  hasUsableBoqPack: boolean;
}): boolean {
  if (!input.requiredCapabilities.includes('project_boundary')) return false;
  return input.completedBatches > 0
    || input.hasUsableBoqPack
    || input.previousStatus === 'running'
    || input.previousStatus === 'complete';
}

function defaultStageConcurrency(stageId: string): number {
  if (stageId === 'tender-document-analysis') return 4;
  if (stageId === 'boq-five-step-pricing') return 4;
  if (stageId === 'project-boundary-conditions') return 4;
  return 1;
}

function loadBoqBatchManifest(
  paths: ReturnType<typeof resolvePaths>,
  projectId: string,
  generatedPacks: TenderCapabilityId[],
  sourceBoundary: TenderSourceBoundary,
  projectRoot: string,
  parentSessionId?: string,
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
    { projectRoot, parentSessionId },
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
  const packPath = capabilityPackPath(paths.projectDirectory, capability);
  const packUsable = packHasUsableContent(packPath, capability);
  const entry = index.capabilities.find((candidate) => candidate.capability === capability);
  if (!entry || entry.revision <= 0 || entry.stale) {
    // Index lag: a non-empty pack on disk is still a usable upstream result.
    return packUsable;
  }
  if (entry.readiness === 'ready') {
    if (capability === 'project_boundary') return packUsable;
    return true;
  }
  // Soft: needs_review AND not_ready both advance when the pack has substance.
  // Audit errors stay visible in the quality panel — they must not trap the pipeline.
  if (entry.readiness === 'needs_review' || entry.readiness === 'not_ready') {
    if (packUsable) return true;
    if (capability === 'document_analysis' && documentManifest) {
      return validateFinalDocumentAnalysisMerge(paths, documentManifest).length === 0;
    }
    if (capability === 'boq_five_step_pricing' && boqManifest) {
      return boqManifest.batchCount > 0
        && boqManifest.completedBatches === boqManifest.batchCount
        && boqManifest.missingItemIds.length === 0;
    }
    return false;
  }
  return false;
}

function capabilityPackPath(projectDirectory: string, capability: TenderCapabilityId): string {
  const fileName = ({
    document_analysis: 'document-analysis.json',
    boq_reconciliation: 'boq-reconciliation.json',
    project_boundary: 'project-boundary.json',
    boq_five_step_pricing: 'boq-five-step-pricing.json',
    construction_resource_schedule: 'construction-resource-schedule.json',
    bidder_commitments: 'bidder-commitments.json',
    execution_plan: 'execution-plan.json',
    schedule_resources: 'schedule-resources.json',
    cost_cashflow: 'cost-cashflow.json',
    submission_documents: 'submission-documents.json',
    submission_audit: 'submission-audit.json',
    evaluation_strategy: 'evaluation-strategy.json',
  } as Partial<Record<TenderCapabilityId, string>>)[capability] ?? `${capability.replace(/_/g, '-')}.json`;
  return join(projectDirectory, 'packs', fileName);
}

function packHasUsableContent(packPath: string, capability: TenderCapabilityId): boolean {
  if (!existsSync(packPath)) return false;
  try {
    const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(packPath, 'utf8')));
    const data = envelope.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return false;
    if (capability === 'document_analysis') {
      return Array.isArray(data.sections) && data.sections.length > 0;
    }
    if (capability === 'boq_five_step_pricing') {
      return Array.isArray(data.itemBuildUps) && data.itemBuildUps.length > 0;
    }
    if (capability === 'boq_reconciliation') {
      return Array.isArray(data.items) && data.items.length > 0;
    }
    if (capability === 'construction_resource_schedule') {
      return Array.isArray(data.rows) && data.rows.length > 0;
    }
    if (capability === 'project_boundary') {
      const outline = (data.organizationOutline as { text?: unknown } | undefined)?.text;
      const measurement = data.standards as { measurementStandard?: { id?: string; title?: string } } | undefined;
      const pricingStandard = (data.pricing as { pricingStandard?: unknown } | undefined)?.pricingStandard;
      const currency = (data.jurisdiction as { currency?: unknown } | undefined)?.currency;
      const outlineText = typeof outline === 'string' ? outline.trim() : '';
      const measurementOk = Boolean(
        measurement?.measurementStandard?.id?.trim()
        || measurement?.measurementStandard?.title?.trim(),
      );
      const confirmed = typeof data.humanConfirmedAt === 'string' && data.humanConfirmedAt.includes('T');
      const sources = Array.isArray(data.boundarySources) ? data.boundarySources as Array<{ path?: string; parseStatus?: string }> : [];
      const parsePending = sources.some((source) => Boolean(source.path) && source.parseStatus === 'registered');
      return outlineText.length >= 80
        && measurementOk
        && typeof pricingStandard === 'string'
        && pricingStandard.trim().length > 0
        && typeof currency === 'string'
        && currency.trim().length > 0
        && confirmed
        && !parsePending;
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureResourceSchedulePack(input: {
  context: SessionToolContext;
  paths: ReturnType<typeof resolvePaths>;
  projectId: string;
  projectRoot: string;
  parentSessionId?: string;
}): Promise<{ errors: string[] }> {
  const pricingPackPath = join(input.paths.projectDirectory, 'packs', 'boq-five-step-pricing.json');
  const artifacts = writeConstructionResourceScheduleArtifacts({
    projectRoot: input.projectRoot,
    projectId: input.projectId,
    pricingPackPath,
    parentSessionId: input.parentSessionId,
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
    // Pack already matches child reports — still refresh formal outputs.
    if (input.parentSessionId) {
      writeDocumentAnalysisSummaryMarkdown(merged.data, {
        projectId: input.projectId,
        parentSessionId: input.parentSessionId,
        workingDirectory: input.workingDirectory,
        manifest: input.manifest,
        projectDirectory: input.paths.projectDirectory,
      });
      publishDocumentAnalysisArtifactsToOfficialOutputs(
        input.workingDirectory,
        input.parentSessionId,
        input.manifest,
      );
      organizeStageDeliverables({
        projectRoot: input.workingDirectory,
        projectId: input.projectId,
        projectDirectory: input.paths.projectDirectory,
        stageId: 'tender-document-analysis',
        parentSessionId: input.parentSessionId,
        documentManifest: input.manifest,
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
      projectDirectory: input.paths.projectDirectory,
    });
    publishDocumentAnalysisArtifactsToOfficialOutputs(
      input.workingDirectory,
      input.parentSessionId,
      input.manifest,
    );
    organizeStageDeliverables({
      projectRoot: input.workingDirectory,
      projectId: input.projectId,
      projectDirectory: input.paths.projectDirectory,
      stageId: 'tender-document-analysis',
      parentSessionId: input.parentSessionId,
      documentManifest: input.manifest,
    });
  }
  return { errors: [] };
}

async function ensureBoundaryPackMerged(input: {
  context: SessionToolContext;
  paths: ReturnType<typeof resolvePaths>;
  projectId: string;
  workingDirectory: string;
  parentSessionId?: string;
  manifest: TenderBoundaryBatchManifest;
  sources: TenderProjectBoundarySource[];
}): Promise<{ errors: string[] }> {
  const existing = readProjectBoundaryPack(input.paths.projectDirectory);
  const suggestion = existing
    ? null
    : suggestProjectBoundaryDraftFromBindings({
        projectDirectory: input.paths.projectDirectory,
        projectId: input.projectId,
      });
  const base = existing?.data ?? suggestion?.draft;
  if (!base) {
    return { errors: ['project_boundary pack missing; generate a draft before merging parse reports'] };
  }
  const merged = mergeBoundaryParseReports({
    pack: base,
    sources: input.sources,
    manifest: input.manifest,
  });
  const packPath = join(input.paths.projectDirectory, 'packs', 'project-boundary.json');
  const action = existsSync(packPath) ? 'replace' : 'init';
  const result = await handleTenderCapability(input.context, {
    action,
    projectId: input.projectId,
    capability: 'project_boundary',
    data: merged,
  });
  if (result.isError) {
    return {
      errors: [result.content.map((block) => block.text).join('\n') || 'project_boundary merge write failed'],
    };
  }
  const saved = readProjectBoundaryPack(input.paths.projectDirectory);
  if (saved && input.parentSessionId) {
    publishProjectBoundaryMarkdown({
      projectRoot: input.workingDirectory,
      parentSessionId: input.parentSessionId,
      pack: saved.data,
    });
    organizeStageDeliverables({
      projectRoot: input.workingDirectory,
      projectId: input.projectId,
      projectDirectory: input.paths.projectDirectory,
      stageId: 'project-boundary-conditions',
      parentSessionId: input.parentSessionId,
      boundaryManifest: input.manifest,
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
  const tasks = taskBoard?.tasks ?? [];
  const taskByBatchId = new Map(tasks.map((task) => [task.batchId, task]));
  return {
    batchType: 'document_analysis',
    itemCount: manifest.documentCount,
    batchCount: manifest.batchCount,
    completedBatches: Math.max(
      manifest.completedBatches,
      tasks.filter((task) => task.status === 'complete').length,
    ),
    missingItemCount: manifest.missingDocumentIds.length,
    manifestPath: manifest.manifestPath,
    ...taskBoardProgress(taskBoard),
    // Hide "failed acceptance" while a child is still writing / being retried —
    // otherwise the red banner invites a second retry that re-quarantines the report.
    invalidBatches: manifest.batches
      .filter((batch) => batch.status === 'invalid')
      .filter((batch) => {
        const task = taskByBatchId.get(batch.batchId);
        if (!task) return true;
        if (task.status === 'running' || task.status === 'pending' || task.status === 'complete') return false;
        if (task.linkedIsProcessing) return false;
        return true;
      })
      .map((batch) => ({ batchId: batch.batchId, errors: batch.validationErrors.slice(0, 3) })),
    validationWarningCount: manifest.batches.reduce((sum, batch) => sum + (batch.validationWarnings?.length ?? 0), 0),
  };
}

function boqBatchProgress(
  manifest: TenderBoqBatchManifest,
  taskBoard?: TenderStageTaskBoard,
): NonNullable<TenderStageRunResult['batchProgress']> {
  const tasks = taskBoard?.tasks ?? [];
  const taskByBatchId = new Map(tasks.map((task) => [task.batchId, task]));
  return {
    batchType: 'boq_five_step_pricing',
    itemCount: manifest.itemCount,
    batchCount: manifest.batchCount,
    completedBatches: Math.max(
      manifest.completedBatches,
      tasks.filter((task) => task.status === 'complete').length,
    ),
    missingItemCount: manifest.missingItemIds.length,
    manifestPath: manifest.manifestPath,
    ...taskBoardProgress(taskBoard),
    invalidBatches: manifest.batches
      .filter((batch) => batch.status === 'invalid')
      .filter((batch) => {
        const task = taskByBatchId.get(batch.batchId);
        if (!task) return true;
        if (task.status === 'running' || task.status === 'pending' || task.status === 'complete') return false;
        if (task.linkedIsProcessing) return false;
        return true;
      })
      .map((batch) => ({ batchId: batch.batchId, errors: batch.validationErrors.slice(0, 3) })),
    validationWarningCount: manifest.batches.reduce((sum, batch) => sum + (batch.validationWarnings?.length ?? 0), 0),
    skippedItems: manifest.skippedItems ?? [],
  };
}

function boundaryBatchProgress(
  manifest: TenderBoundaryBatchManifest,
  taskBoard?: TenderStageTaskBoard,
): NonNullable<TenderStageRunResult['batchProgress']> {
  const tasks = taskBoard?.tasks ?? [];
  const taskByBatchId = new Map(tasks.map((task) => [task.batchId, task]));
  return {
    batchType: 'project_boundary',
    itemCount: manifest.sourceCount,
    batchCount: manifest.batchCount,
    completedBatches: Math.max(
      manifest.completedBatches,
      tasks.filter((task) => task.status === 'complete').length,
    ),
    missingItemCount: manifest.missingSourceIds.length,
    manifestPath: manifest.manifestPath,
    ...taskBoardProgress(taskBoard),
    invalidBatches: manifest.batches
      .filter((batch) => batch.status === 'invalid')
      .filter((batch) => {
        const task = taskByBatchId.get(batch.batchId);
        if (!task) return true;
        if (task.status === 'running' || task.status === 'pending' || task.status === 'complete') return false;
        if (task.linkedIsProcessing) return false;
        return true;
      })
      .map((batch) => ({ batchId: batch.batchId, errors: batch.validationErrors.slice(0, 3) })),
    validationWarningCount: manifest.batches.reduce((sum, batch) => sum + (batch.validationWarnings?.length ?? 0), 0),
  };
}

function taskBoardProgress(taskBoard?: TenderStageTaskBoard) {
  const tasks = taskBoard?.tasks ?? [];
  // A "failed" row that is still linked to a live processing session is mid-rewrite —
  // count it as running for the control panel so users don't click 重试 again.
  const visiblyFailed = tasks.filter((task) => (
    task.status === 'failed' && task.linkedIsProcessing !== true
  ));
  const visiblyRunning = tasks.filter((task) => (
    task.status === 'running'
    || (task.status === 'failed' && task.linkedIsProcessing === true)
  ));
  return {
    taskBoardPath: taskBoard?.taskBoardPath,
    parentSessionId: taskBoard?.parentSessionId,
    dispatchEnabled: taskBoard?.dispatchEnabled !== false,
    pendingBatches: tasks.filter((task) => task.status === 'pending').length,
    runningBatches: visiblyRunning.length,
    failedBatches: visiblyFailed.length,
    blockedBatches: tasks.filter((task) => task.status === 'blocked').length,
    tasks,
  };
}

function buildBatchTaskSpecs(
  documentManifest: TenderDocumentAnalysisBatchManifest | undefined,
  boqManifest: TenderBoqBatchManifest | undefined,
  sourceBoundary: TenderSourceBoundary,
  boundaryManifest?: TenderBoundaryBatchManifest,
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
  if (boundaryManifest) {
    if (boundaryManifest.batches.length === 0) return undefined;
    return boundaryManifest.batches.map((batch) => ({
      batchId: batch.batchId,
      briefPath: batch.briefPath,
      reportPath: batch.reportPath,
      markdownPath: batch.markdownPath,
      allowedSourcePaths: batch.sourcePath ? [batch.sourcePath] : [],
      validationStatus: batch.status,
      validationErrors: batch.validationErrors,
      name: `Project boundary parse · ${batch.sourceId}`,
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
    boundaryBatchManifestPath: join(projectDirectory, 'boundary-batch-manifest.json'),
  };
}

function publicPaths(
  paths: ReturnType<typeof resolvePaths>,
  taskBoard?: TenderStageTaskBoard,
  stageId?: string,
): TenderStageRunResult['paths'] {
  const catalogPath = stageId
    ? stageDeliverablesCatalogPath(paths.projectDirectory, stageId)
    : undefined;
  return {
    projectDirectory: paths.projectDirectory,
    workspacePath: paths.workspacePath,
    sourceBoundaryPath: paths.sourceBoundaryPath,
    stageStatePath: paths.stageStatePath,
    documentAnalysisBatchManifestPath: existsSync(paths.documentAnalysisBatchManifestPath) ? paths.documentAnalysisBatchManifestPath : undefined,
    boqBatchManifestPath: existsSync(paths.boqBatchManifestPath) ? paths.boqBatchManifestPath : undefined,
    boundaryBatchManifestPath: existsSync(paths.boundaryBatchManifestPath) ? paths.boundaryBatchManifestPath : undefined,
    taskBoardPath: taskBoard?.taskBoardPath,
    ...(catalogPath && existsSync(catalogPath) ? { stageDeliverablesCatalogPath: catalogPath } : {}),
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

function omitVolatileTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitVolatileTimestamps);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'updatedAt' || key === 'generatedAt') continue;
      out[key] = omitVolatileTimestamps(nested);
    }
    return out;
  }
  return value;
}

function writeJsonIfFingerprintUnchanged(filePath: string, value: unknown): boolean {
  if (existsSync(filePath)) {
    try {
      const previous = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
      if (JSON.stringify(omitVolatileTimestamps(previous)) === JSON.stringify(omitVolatileTimestamps(value))) {
        return false;
      }
    } catch {
      // fall through to write
    }
  }
  atomicWriteJson(filePath, value);
  return true;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}
