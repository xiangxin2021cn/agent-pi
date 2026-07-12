import {
  auditDeliveryContractScope,
  auditDeliveryProgrammeProgress,
  auditDeliveryResourceProcurement,
  getDeliveryCapabilityDependencies,
  isDeliveryCapabilityStale,
  parseDeliveryCapabilityEnvelope,
  parseDeliveryCapabilityIndex,
  parseDeliveryContractScopeData,
  parseDeliveryProgrammeProgressData,
  parseDeliveryResourceProcurementData,
  parseDeliveryWorkspace,
  type DeliveryCapabilityAuditIssue,
  type DeliveryCapabilityEnvelope,
  type DeliveryCapabilityId,
  type DeliveryCapabilityIndex,
  type DeliveryCapabilityIndexEntry,
  type DeliveryCapabilityReadiness,
  type DeliveryWorkspace,
} from '@agent-pi/business-core/delivery';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';

export type DeliveryCapabilityAction = 'configure' | 'init' | 'replace' | 'status' | 'validate';

export interface DeliveryCapabilityArgs {
  action: DeliveryCapabilityAction;
  projectId: string;
  capability: DeliveryCapabilityId;
  data?: unknown;
  expectedRevision?: number;
  enabled?: boolean;
  required?: boolean;
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITY_FILES: Record<DeliveryCapabilityId, string> = {
  contract_scope: 'contract-scope',
  programme_progress: 'programme-progress',
  resource_procurement: 'resource-procurement',
  cost_commercial: 'cost-commercial',
  cashflow: 'cashflow',
  risk_change: 'risk-change',
  reporting_audit: 'reporting-audit',
};

export async function handleDeliveryCapability(ctx: SessionToolContext, args: DeliveryCapabilityArgs) {
  try {
    if (!ctx.workingDirectory) return errorResponse('delivery_capability requires an explicit session working directory.');
    if (!SAFE_PROJECT_ID.test(args.projectId)) return errorResponse('projectId must be a filesystem-safe identifier.');
    if (!isImplemented(args.capability)) return errorResponse(`Delivery capability ${args.capability} is not implemented.`);
    if (args.required === true && args.enabled === false) return errorResponse('A required capability must be enabled.');

    const paths = resolvePaths(ctx.workingDirectory, args.projectId, args.capability);
    if (!isPathWithinDirectoryForCreation(paths.projectDirectory, ctx.workingDirectory)) return errorResponse('Resolved delivery project path escapes the session working directory.');
    if (!existsSync(paths.corePath)) return errorResponse(`Delivery workspace ${args.projectId} does not exist. Call delivery_workspace init first.`);
    const workspace = parseDeliveryWorkspace(JSON.parse(readFileSync(paths.corePath, 'utf8')));
    let index = readIndex(paths.indexPath, args.projectId, workspace.revision);

    if (args.action === 'configure') {
      const current = index.capabilities.find((entry) => entry.capability === args.capability);
      const enabled = args.enabled ?? current?.enabled ?? true;
      const required = args.required ?? current?.required ?? false;
      if (required && !enabled) return errorResponse('A required capability must be enabled.');
      const entry: DeliveryCapabilityIndexEntry = {
        capability: args.capability,
        enabled,
        required,
        revision: current?.revision ?? 0,
        readiness: current?.readiness ?? 'not_ready',
        issueCount: current?.issueCount ?? 0,
        stale: current?.stale ?? false,
        updatedAt: new Date().toISOString(),
      };
      index = upsertIndexEntry(index, entry, workspace.revision);
      atomicWriteJson(paths.indexPath, index);
      return successResponse(JSON.stringify({ indexEntry: entry, indexPath: paths.indexPath }, null, 2));
    }

    if (args.action === 'init' && existsSync(paths.modelPath)) return errorResponse(`Delivery capability ${args.capability} already exists.`);
    if (args.action !== 'init' && !existsSync(paths.modelPath)) return errorResponse(`Delivery capability ${args.capability} does not exist. Call init first.`);

    if (args.action === 'init' || args.action === 'replace') {
      if (args.data === undefined) return errorResponse(`${args.action} requires data.`);
      const upstreamError = findUpstreamReadinessError(index, args.capability);
      if (upstreamError) return errorResponse(upstreamError);
      const current = existsSync(paths.modelPath)
        ? parseDeliveryCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')))
        : undefined;
      if (args.action === 'replace' && args.expectedRevision !== undefined && current?.revision !== args.expectedRevision) {
        return errorResponse(`Delivery capability revision conflict: expected ${args.expectedRevision}, current ${current?.revision ?? 0}.`);
      }
      const updatedAt = new Date().toISOString();
      const envelope = parseDeliveryCapabilityEnvelope({
        schemaVersion: 1,
        capability: args.capability,
        projectId: args.projectId,
        revision: (current?.revision ?? 0) + 1,
        coreRevision: workspace.revision,
        upstream: buildUpstream(index, args.capability, workspace.revision),
        updatedAt,
        data: parseCapabilityData(args.capability, args.data),
      });
      const audit = auditCapability(
        args.capability,
        workspace,
        envelope.data,
        loadUpstreamData(paths.projectDirectory, args.capability),
        updatedAt,
      );
      index = updateIndex(index, args, envelope, audit, false, workspace.revision);
      persist(paths, envelope, audit, index);
      return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, false), null, 2));
    }

    const envelope = parseDeliveryCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')));
    const audit = auditCapability(
      args.capability,
      workspace,
      envelope.data,
      loadUpstreamData(paths.projectDirectory, args.capability),
    );
    const revisions = Object.fromEntries(index.capabilities.map((entry) => [entry.capability, entry.revision]));
    const stale = isDeliveryCapabilityStale(envelope, workspace.revision, revisions)
      || findUpstreamReadinessError(index, args.capability) !== undefined;
    index = updateIndex(index, args, envelope, audit, stale, workspace.revision);
    atomicWriteJson(paths.indexPath, index);
    if (args.action === 'validate') atomicWriteJson(paths.auditPath, audit);
    return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, stale), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function isImplemented(capability: DeliveryCapabilityId): capability is 'contract_scope' | 'programme_progress' | 'resource_procurement' {
  return capability === 'contract_scope' || capability === 'programme_progress' || capability === 'resource_procurement';
}

function parseCapabilityData(capability: DeliveryCapabilityId, data: unknown): unknown {
  if (capability === 'contract_scope') return parseDeliveryContractScopeData(data);
  if (capability === 'programme_progress') return parseDeliveryProgrammeProgressData(data);
  if (capability === 'resource_procurement') return parseDeliveryResourceProcurementData(data);
  throw new Error(`Delivery capability ${capability} is not implemented.`);
}

function auditCapability(
  capability: DeliveryCapabilityId,
  workspace: DeliveryWorkspace,
  data: unknown,
  upstreamData: Partial<Record<DeliveryCapabilityId, unknown>>,
  generatedAt?: string,
): { readiness: DeliveryCapabilityReadiness; issues: DeliveryCapabilityAuditIssue[] } {
  if (capability === 'contract_scope') return auditDeliveryContractScope(workspace, data, generatedAt);
  if (capability === 'programme_progress') {
    return auditDeliveryProgrammeProgress(workspace, upstreamData.contract_scope, data, generatedAt);
  }
  if (capability === 'resource_procurement') {
    return auditDeliveryResourceProcurement(
      workspace,
      upstreamData.contract_scope,
      upstreamData.programme_progress,
      data,
      generatedAt,
    );
  }
  throw new Error(`Delivery capability ${capability} is not implemented.`);
}

function loadUpstreamData(
  projectDirectory: string,
  capability: DeliveryCapabilityId,
): Partial<Record<DeliveryCapabilityId, unknown>> {
  const enabled: DeliveryCapabilityId[] = Object.keys(CAPABILITY_FILES) as DeliveryCapabilityId[];
  const upstreamData: Partial<Record<DeliveryCapabilityId, unknown>> = {};
  for (const dependency of getDeliveryCapabilityDependencies(capability, enabled)) {
    if (dependency === 'core') continue;
    const filePath = join(projectDirectory, 'packs', `${CAPABILITY_FILES[dependency]}.json`);
    if (!existsSync(filePath)) continue;
    const envelope = parseDeliveryCapabilityEnvelope(JSON.parse(readFileSync(filePath, 'utf8')));
    upstreamData[dependency] = envelope.data;
  }
  return upstreamData;
}

function findUpstreamReadinessError(index: DeliveryCapabilityIndex, capability: DeliveryCapabilityId): string | undefined {
  const enabled = index.capabilities.filter((entry) => entry.enabled).map((entry) => entry.capability);
  for (const dependency of getDeliveryCapabilityDependencies(capability, enabled)) {
    if (dependency === 'core') continue;
    const entry = index.capabilities.find((candidate) => candidate.capability === dependency);
    if (!entry || entry.revision === 0 || entry.readiness !== 'ready' || entry.stale) {
      return `Delivery capability ${capability} requires ready upstream capability ${dependency}.`;
    }
  }
  return undefined;
}

function buildUpstream(index: DeliveryCapabilityIndex, capability: DeliveryCapabilityId, coreRevision: number) {
  const enabled = index.capabilities.filter((entry) => entry.enabled).map((entry) => entry.capability);
  const revisions = new Map(index.capabilities.map((entry) => [entry.capability, entry.revision]));
  return getDeliveryCapabilityDependencies(capability, enabled).map((dependency) => ({
    capability: dependency,
    revision: dependency === 'core' ? coreRevision : (revisions.get(dependency) ?? 0),
  }));
}

function updateIndex(
  index: DeliveryCapabilityIndex,
  args: DeliveryCapabilityArgs,
  envelope: DeliveryCapabilityEnvelope,
  audit: { readiness: DeliveryCapabilityReadiness; issues: DeliveryCapabilityAuditIssue[] },
  stale: boolean,
  coreRevision: number,
): DeliveryCapabilityIndex {
  const current = index.capabilities.find((entry) => entry.capability === args.capability);
  return upsertIndexEntry(index, {
    capability: args.capability,
    enabled: args.enabled ?? current?.enabled ?? true,
    required: args.required ?? current?.required ?? false,
    revision: envelope.revision,
    readiness: stale ? 'not_ready' : audit.readiness,
    issueCount: audit.issues.length,
    stale,
    updatedAt: new Date().toISOString(),
  }, coreRevision);
}

function upsertIndexEntry(index: DeliveryCapabilityIndex, entry: DeliveryCapabilityIndexEntry, coreRevision: number): DeliveryCapabilityIndex {
  const entries = new Map(index.capabilities.map((current) => [current.capability, current]));
  entries.set(entry.capability, entry);
  return parseDeliveryCapabilityIndex({ ...index, coreRevision, capabilities: [...entries.values()] });
}

function readIndex(indexPath: string, projectId: string, coreRevision: number): DeliveryCapabilityIndex {
  if (!existsSync(indexPath)) return { schemaVersion: 1, projectId, coreRevision, capabilities: [] };
  return parseDeliveryCapabilityIndex(JSON.parse(readFileSync(indexPath, 'utf8')));
}

function resolvePaths(workingDirectory: string, projectId: string, capability: DeliveryCapabilityId) {
  const projectDirectory = resolve(workingDirectory, '.agent-pi', 'business', 'delivery', projectId);
  const fileName = CAPABILITY_FILES[capability];
  return {
    projectDirectory,
    corePath: join(projectDirectory, 'delivery-workspace.json'),
    indexPath: join(projectDirectory, 'capability-index.json'),
    modelPath: join(projectDirectory, 'packs', `${fileName}.json`),
    auditPath: join(projectDirectory, 'audits', `${fileName}-audit.json`),
  };
}

function buildResult(
  paths: ReturnType<typeof resolvePaths>,
  envelope: DeliveryCapabilityEnvelope,
  audit: { readiness: DeliveryCapabilityReadiness; issues: DeliveryCapabilityAuditIssue[] },
  index: DeliveryCapabilityIndex,
  stale: boolean,
) {
  return {
    envelope,
    audit,
    stale,
    effectiveReadiness: stale ? 'not_ready' : audit.readiness,
    indexEntry: index.capabilities.find((entry) => entry.capability === envelope.capability),
    modelPath: paths.modelPath,
    auditPath: paths.auditPath,
    indexPath: paths.indexPath,
  };
}

function persist(
  paths: ReturnType<typeof resolvePaths>,
  envelope: DeliveryCapabilityEnvelope,
  audit: { readiness: DeliveryCapabilityReadiness; issues: DeliveryCapabilityAuditIssue[] },
  index: DeliveryCapabilityIndex,
): void {
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
