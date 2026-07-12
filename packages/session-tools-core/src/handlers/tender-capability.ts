import {
  auditTenderEvaluationStrategy,
  auditTenderBoqReconciliation,
  auditTenderExecutionPlan,
  auditTenderScheduleResources,
  auditTenderCostCashFlow,
  auditTenderSubmission,
  getTenderCapabilityDependencies,
  isTenderCapabilityStale,
  parseTenderCapabilityEnvelope,
  parseTenderCapabilityIndex,
  parseTenderEvaluationStrategyData,
  parseTenderBoqReconciliationData,
  parseTenderExecutionPlanData,
  parseTenderScheduleResourceData,
  parseTenderCostCashFlowData,
  parseTenderSubmissionAuditData,
  parseTenderWorkspace,
  type TenderCapabilityAuditIssue,
  type TenderCapabilityEnvelope,
  type TenderCapabilityId,
  type TenderCapabilityIndex,
  type TenderCapabilityIndexEntry,
  type TenderCapabilityReadiness,
  type TenderEvaluationStrategyAudit,
  type TenderBoqReconciliationAudit,
  type TenderExecutionPlanAudit,
  type TenderScheduleResourceAudit,
  type TenderCostCashFlowAudit,
  type TenderSubmissionAudit,
  type TenderWorkspace,
} from '@agent-pi/business-core/tender';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectory, isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';

export type TenderCapabilityAction = 'configure' | 'init' | 'replace' | 'status' | 'validate';

export interface TenderCapabilityArgs {
  action: TenderCapabilityAction;
  projectId: string;
  capability: TenderCapabilityId;
  data?: unknown;
  expectedRevision?: number;
  enabled?: boolean;
  required?: boolean;
}

type ImplementedAudit =
  | TenderEvaluationStrategyAudit
  | TenderBoqReconciliationAudit
  | TenderExecutionPlanAudit
  | TenderScheduleResourceAudit
  | TenderCostCashFlowAudit
  | TenderSubmissionAudit;

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITY_FILE_NAMES: Record<TenderCapabilityId, string> = {
  evaluation_strategy: 'evaluation-strategy',
  boq_reconciliation: 'boq-reconciliation',
  execution_plan: 'execution-plan',
  schedule_resources: 'schedule-resources',
  cost_cashflow: 'cost-cashflow',
  submission_audit: 'submission-audit',
};

export async function handleTenderCapability(
  ctx: SessionToolContext,
  args: TenderCapabilityArgs,
) {
  try {
    if (!ctx.workingDirectory) {
      return errorResponse('tender_capability requires an explicit session working directory.');
    }
    if (!SAFE_PROJECT_ID.test(args.projectId)) {
      return errorResponse('projectId must be a filesystem-safe identifier.');
    }
    if (!isImplementedCapability(args.capability)) {
      return errorResponse(`Tender capability ${args.capability} is not implemented.`);
    }
    if (args.required === true && args.enabled === false) {
      return errorResponse('A required capability must be enabled.');
    }

    const paths = resolvePaths(ctx.workingDirectory, args.projectId, args.capability);
    if (!isPathWithinDirectoryForCreation(paths.projectDirectory, ctx.workingDirectory)) {
      return errorResponse('Resolved tender project path escapes the session working directory.');
    }
    if (!existsSync(paths.corePath)) {
      return errorResponse(`Tender workspace ${args.projectId} does not exist. Call tender_workspace init first.`);
    }

    const workspace = parseTenderWorkspace(JSON.parse(readFileSync(paths.corePath, 'utf8')));
    let index = readIndex(paths.indexPath, args.projectId, workspace.revision);

    if (args.action === 'configure') {
      const current = index.capabilities.find((entry) => entry.capability === args.capability);
      const enabled = args.enabled ?? current?.enabled ?? true;
      const required = args.required ?? current?.required ?? false;
      if (required && !enabled) return errorResponse('A required capability must be enabled.');

      const updatedAt = new Date().toISOString();
      const entry: TenderCapabilityIndexEntry = {
        capability: args.capability,
        enabled,
        required,
        revision: current?.revision ?? 0,
        readiness: current?.readiness ?? 'not_ready',
        issueCount: current?.issueCount ?? 0,
        stale: current?.stale ?? false,
        updatedAt,
      };
      index = upsertIndexEntry(index, entry, workspace.revision);
      mkdirSync(paths.projectDirectory, { recursive: true });
      atomicWriteJson(paths.indexPath, index);
      return successResponse(JSON.stringify({ indexEntry: entry, indexPath: paths.indexPath }, null, 2));
    }

    if (args.action === 'init' && existsSync(paths.modelPath)) {
      return errorResponse(`Tender capability ${args.capability} already exists.`);
    }
    if (args.action !== 'init' && !existsSync(paths.modelPath)) {
      return errorResponse(`Tender capability ${args.capability} does not exist. Call init first.`);
    }

    if (args.action === 'init' || args.action === 'replace') {
      if (args.data === undefined) return errorResponse(`${args.action} requires data.`);
      const upstreamError = findUpstreamReadinessError(index, args.capability);
      if (upstreamError) return errorResponse(upstreamError);
      const current = existsSync(paths.modelPath)
        ? parseTenderCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')))
        : undefined;
      if (
        args.action === 'replace'
        && args.expectedRevision !== undefined
        && current?.revision !== args.expectedRevision
      ) {
        return errorResponse(
          `Tender capability revision conflict: expected ${args.expectedRevision}, current ${current?.revision ?? 0}.`,
        );
      }

      const updatedAt = new Date().toISOString();
      const envelope: TenderCapabilityEnvelope = parseTenderCapabilityEnvelope({
        schemaVersion: 1,
        capability: args.capability,
        projectId: args.projectId,
        revision: (current?.revision ?? 0) + 1,
        coreRevision: workspace.revision,
        upstream: buildUpstream(index, args.capability, workspace.revision),
        updatedAt,
        data: await parseCapabilityData(args.capability, args.data, ctx.workingDirectory),
      });
      const audit = auditCapability(
        args.capability,
        workspace,
        envelope.data,
        loadUpstreamData(paths.projectDirectory, args.capability),
        index,
        updatedAt,
      );
      index = updateIndexFromAudit(index, args, envelope, audit, false, workspace.revision);
      persistCapability(paths, envelope, audit, index);
      return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, false), null, 2));
    }

    const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')));
    const audit = auditCapability(
      args.capability,
      workspace,
      envelope.data,
      loadUpstreamData(paths.projectDirectory, args.capability),
      index,
    );
    const revisions = Object.fromEntries(index.capabilities.map((entry) => [entry.capability, entry.revision]));
    const stale = isTenderCapabilityStale(envelope, workspace.revision, revisions)
      || findUpstreamReadinessError(index, args.capability) !== undefined;
    index = updateIndexFromAudit(index, args, envelope, audit, stale, workspace.revision);
    atomicWriteJson(paths.indexPath, index);
    if (args.action === 'validate') atomicWriteJson(paths.auditPath, audit);
    return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, stale), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function isImplementedCapability(
  capability: TenderCapabilityId,
): capability is
  | 'evaluation_strategy'
  | 'boq_reconciliation'
  | 'execution_plan'
  | 'schedule_resources'
  | 'cost_cashflow'
  | 'submission_audit' {
  return capability === 'evaluation_strategy'
    || capability === 'boq_reconciliation'
    || capability === 'execution_plan'
    || capability === 'schedule_resources'
    || capability === 'cost_cashflow'
    || capability === 'submission_audit';
}

async function parseCapabilityData(
  capability: TenderCapabilityId,
  data: unknown,
  workingDirectory: string,
): Promise<unknown> {
  if (capability === 'evaluation_strategy') return parseTenderEvaluationStrategyData(data);
  if (capability === 'boq_reconciliation') return parseTenderBoqReconciliationData(data);
  if (capability === 'execution_plan') return parseTenderExecutionPlanData(data);
  if (capability === 'schedule_resources') return parseTenderScheduleResourceData(data);
  if (capability === 'cost_cashflow') return parseTenderCostCashFlowData(data);
  if (capability === 'submission_audit') {
    return verifySubmissionRuntimeData(parseTenderSubmissionAuditData(data), workingDirectory);
  }
  throw new Error(`Tender capability ${capability} is not implemented.`);
}

async function verifySubmissionRuntimeData(
  data: ReturnType<typeof parseTenderSubmissionAuditData>,
  workingDirectory: string,
): Promise<ReturnType<typeof parseTenderSubmissionAuditData>> {
  return {
    ...data,
    items: await Promise.all(data.items.map(async (item) => {
      const filePath = isAbsolute(item.filePath) ? resolve(item.filePath) : resolve(workingDirectory, item.filePath);
      const filePresent = isPathWithinDirectory(filePath, workingDirectory) && existsSync(filePath);
      const format = item.format.toLowerCase().replace(/^\./, '');
      const formatMatch = extname(filePath).toLowerCase().replace(/^\./, '') === format;
      const hashVerified = filePresent && await hashFile(filePath) === item.sha256.toLowerCase();
      return {
        ...item,
        checks: {
          ...item.checks,
          filePresent,
          formatMatch,
          hashVerified,
        },
      };
    })),
  };
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function auditCapability(
  capability: TenderCapabilityId,
  workspace: TenderWorkspace,
  data: unknown,
  upstreamData: Partial<Record<TenderCapabilityId, unknown>>,
  index: TenderCapabilityIndex,
  generatedAt?: string,
): ImplementedAudit {
  if (capability === 'evaluation_strategy') {
    return auditTenderEvaluationStrategy(workspace, data, generatedAt);
  }
  if (capability === 'boq_reconciliation') {
    return auditTenderBoqReconciliation(workspace, data, generatedAt);
  }
  if (capability === 'execution_plan') {
    return auditTenderExecutionPlan(workspace, upstreamData.boq_reconciliation, data, generatedAt);
  }
  if (capability === 'schedule_resources') {
    return auditTenderScheduleResources(workspace, upstreamData.execution_plan, data, generatedAt);
  }
  if (capability === 'cost_cashflow') {
    return auditTenderCostCashFlow(
      workspace,
      upstreamData.boq_reconciliation,
      upstreamData.schedule_resources,
      data,
      generatedAt,
    );
  }
  if (capability === 'submission_audit') {
    return auditTenderSubmission(workspace, index, data, generatedAt);
  }
  throw new Error(`Tender capability ${capability} is not implemented.`);
}

function findUpstreamReadinessError(
  index: TenderCapabilityIndex,
  capability: TenderCapabilityId,
): string | undefined {
  const enabled = index.capabilities.filter((entry) => entry.enabled).map((entry) => entry.capability);
  for (const dependency of getTenderCapabilityDependencies(capability, enabled)) {
    if (dependency === 'core') continue;
    const entry = index.capabilities.find((candidate) => candidate.capability === dependency);
    if (!entry || entry.revision === 0 || entry.readiness !== 'ready' || entry.stale) {
      return `Tender capability ${capability} requires ready upstream capability ${dependency}.`;
    }
  }
  return undefined;
}

function loadUpstreamData(
  projectDirectory: string,
  capability: TenderCapabilityId,
): Partial<Record<TenderCapabilityId, unknown>> {
  const result: Partial<Record<TenderCapabilityId, unknown>> = {};
  for (const dependency of getTenderCapabilityDependencies(capability)) {
    if (dependency === 'core') continue;
    const modelPath = join(projectDirectory, 'packs', `${CAPABILITY_FILE_NAMES[dependency]}.json`);
    if (!existsSync(modelPath)) continue;
    result[dependency] = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(modelPath, 'utf8'))).data;
  }
  return result;
}

function buildUpstream(
  index: TenderCapabilityIndex,
  capability: TenderCapabilityId,
  coreRevision: number,
) {
  const enabled = index.capabilities.filter((entry) => entry.enabled).map((entry) => entry.capability);
  const revisionByCapability = new Map(index.capabilities.map((entry) => [entry.capability, entry.revision]));
  return getTenderCapabilityDependencies(capability, enabled).map((dependency) => ({
    capability: dependency,
    revision: dependency === 'core' ? coreRevision : (revisionByCapability.get(dependency) ?? 0),
  }));
}

function updateIndexFromAudit(
  index: TenderCapabilityIndex,
  args: TenderCapabilityArgs,
  envelope: TenderCapabilityEnvelope,
  audit: { readiness: TenderCapabilityReadiness; issues: TenderCapabilityAuditIssue[] },
  stale: boolean,
  currentCoreRevision: number,
): TenderCapabilityIndex {
  const current = index.capabilities.find((entry) => entry.capability === args.capability);
  const enabled = args.enabled ?? current?.enabled ?? true;
  const required = args.required ?? current?.required ?? false;
  if (required && !enabled) throw new Error('A required capability must be enabled.');
  return upsertIndexEntry(index, {
    capability: args.capability,
    enabled,
    required,
    revision: envelope.revision,
    readiness: stale ? 'not_ready' : audit.readiness,
    issueCount: audit.issues.length,
    stale,
    updatedAt: new Date().toISOString(),
  }, currentCoreRevision);
}

function upsertIndexEntry(
  index: TenderCapabilityIndex,
  entry: TenderCapabilityIndexEntry,
  coreRevision: number,
): TenderCapabilityIndex {
  const entries = new Map(index.capabilities.map((current) => [current.capability, current]));
  entries.set(entry.capability, entry);
  return parseTenderCapabilityIndex({
    ...index,
    coreRevision,
    capabilities: [...entries.values()],
  });
}

function readIndex(indexPath: string, projectId: string, coreRevision: number): TenderCapabilityIndex {
  if (!existsSync(indexPath)) {
    return {
      schemaVersion: 1,
      projectId,
      coreRevision,
      capabilities: [],
    };
  }
  return parseTenderCapabilityIndex(JSON.parse(readFileSync(indexPath, 'utf8')));
}

function buildResult(
  paths: ReturnType<typeof resolvePaths>,
  envelope: TenderCapabilityEnvelope,
  audit: ImplementedAudit,
  index: TenderCapabilityIndex,
  stale: boolean,
) {
  const indexEntry = index.capabilities.find((entry) => entry.capability === envelope.capability);
  return {
    envelope,
    audit,
    stale,
    effectiveReadiness: stale ? 'not_ready' : audit.readiness,
    indexEntry,
    modelPath: paths.modelPath,
    auditPath: paths.auditPath,
    indexPath: paths.indexPath,
  };
}

function resolvePaths(workingDirectory: string, projectId: string, capability: TenderCapabilityId) {
  const projectDirectory = resolve(workingDirectory, '.agent-pi', 'business', 'tender', projectId);
  const fileName = CAPABILITY_FILE_NAMES[capability];
  return {
    projectDirectory,
    corePath: join(projectDirectory, 'tender-workspace.json'),
    indexPath: join(projectDirectory, 'capability-index.json'),
    modelPath: join(projectDirectory, 'packs', `${fileName}.json`),
    auditPath: join(projectDirectory, 'audits', `${fileName}-audit.json`),
  };
}

function persistCapability(
  paths: ReturnType<typeof resolvePaths>,
  envelope: TenderCapabilityEnvelope,
  audit: ImplementedAudit,
  index: TenderCapabilityIndex,
): void {
  mkdirSync(join(paths.projectDirectory, 'packs'), { recursive: true });
  mkdirSync(join(paths.projectDirectory, 'audits'), { recursive: true });
  atomicWriteJson(paths.modelPath, envelope);
  atomicWriteJson(paths.auditPath, audit);
  atomicWriteJson(paths.indexPath, index);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
