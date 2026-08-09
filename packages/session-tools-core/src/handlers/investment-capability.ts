import {
  auditInvestmentCapability,
  getInvestmentCapabilityDependencies,
  isInvestmentCapabilityStale,
  parseInvestmentCapabilityData,
  parseInvestmentCapabilityEnvelope,
  parseInvestmentCapabilityIndex,
  parseInvestmentWorkspace,
  type InvestmentCapabilityAudit,
  type InvestmentCapabilityEnvelope,
  type InvestmentCapabilityId,
  type InvestmentCapabilityIndex,
  type InvestmentCapabilityIndexEntry,
} from '@agent-pi/business-core/investment';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';
import { requireContextWorkingDirectory } from '../working-directory.ts';

export type InvestmentCapabilityAction = 'configure' | 'init' | 'replace' | 'status' | 'validate';

export interface InvestmentCapabilityArgs {
  action: InvestmentCapabilityAction;
  projectId: string;
  capability: InvestmentCapabilityId;
  data?: unknown;
  expectedRevision?: number;
  enabled?: boolean;
  required?: boolean;
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITY_FILES: Record<InvestmentCapabilityId, string> = {
  mandate_screening: 'mandate-screening',
  resource_technical: 'resource-technical',
  market_offtake: 'market-offtake',
  legal_esg: 'legal-esg',
  financial_valuation: 'financial-valuation',
  transaction_decision: 'transaction-decision',
};

export async function handleInvestmentCapability(ctx: SessionToolContext, args: InvestmentCapabilityArgs) {
  try {
    const workingDirectory = requireContextWorkingDirectory(ctx, 'investment_capability');
    if (typeof workingDirectory !== 'string') return workingDirectory;
    if (!SAFE_PROJECT_ID.test(args.projectId)) return errorResponse('projectId must be a filesystem-safe identifier.');
    if (args.required === true && args.enabled === false) return errorResponse('A required capability must be enabled.');
    const paths = resolvePaths(workingDirectory, args.projectId, args.capability);
    if (!isPathWithinDirectoryForCreation(paths.projectDirectory, workingDirectory)) return errorResponse('Resolved investment project path escapes the session working directory.');
    if (!existsSync(paths.corePath)) return errorResponse(`Investment workspace ${args.projectId} does not exist. Call investment_workspace init first.`);
    const workspace = parseInvestmentWorkspace(JSON.parse(readFileSync(paths.corePath, 'utf8')));
    let index = readIndex(paths.indexPath, args.projectId, workspace.revision);

    if (args.action === 'configure') {
      const current = index.capabilities.find((entry) => entry.capability === args.capability);
      const enabled = args.enabled ?? current?.enabled ?? true;
      const required = args.required ?? current?.required ?? false;
      if (required && !enabled) return errorResponse('A required capability must be enabled.');
      const entry: InvestmentCapabilityIndexEntry = {
        capability: args.capability, enabled, required, revision: current?.revision ?? 0,
        readiness: current?.readiness ?? 'not_ready', issueCount: current?.issueCount ?? 0,
        stale: current?.stale ?? false, updatedAt: new Date().toISOString(),
      };
      index = upsertIndexEntry(index, entry, workspace.revision);
      atomicWriteJson(paths.indexPath, index);
      return successResponse(JSON.stringify({ indexEntry: entry, indexPath: paths.indexPath }, null, 2));
    }

    if (args.action === 'init' && existsSync(paths.modelPath)) return errorResponse(`Investment capability ${args.capability} already exists.`);
    if (args.action !== 'init' && !existsSync(paths.modelPath)) return errorResponse(`Investment capability ${args.capability} does not exist. Call init first.`);

    if (args.action === 'init' || args.action === 'replace') {
      if (args.data === undefined) return errorResponse(`${args.action} requires data.`);
      const upstreamError = findUpstreamReadinessError(index, args.capability);
      if (upstreamError) return errorResponse(upstreamError);
      const current = existsSync(paths.modelPath)
        ? parseInvestmentCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')))
        : undefined;
      if (args.action === 'replace' && args.expectedRevision !== undefined && current?.revision !== args.expectedRevision) {
        return errorResponse(`Investment capability revision conflict: expected ${args.expectedRevision}, current ${current?.revision ?? 0}.`);
      }
      const updatedAt = new Date().toISOString();
      const envelope = parseInvestmentCapabilityEnvelope({
        schemaVersion: 1, capability: args.capability, projectId: args.projectId,
        revision: (current?.revision ?? 0) + 1, coreRevision: workspace.revision,
        upstream: buildUpstream(index, args.capability, workspace.revision),
        updatedAt, data: parseInvestmentCapabilityData(args.data),
      });
      const audit = auditInvestmentCapability(args.capability, workspace, envelope.data, updatedAt);
      index = updateIndex(index, args, envelope, audit, false, workspace.revision);
      persist(paths, envelope, audit, index);
      return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, false), null, 2));
    }

    const envelope = parseInvestmentCapabilityEnvelope(JSON.parse(readFileSync(paths.modelPath, 'utf8')));
    const audit = auditInvestmentCapability(args.capability, workspace, envelope.data);
    const revisions = Object.fromEntries(index.capabilities.map((entry) => [entry.capability, entry.revision]));
    const stale = isInvestmentCapabilityStale(envelope, workspace.revision, revisions)
      || findUpstreamReadinessError(index, args.capability) !== undefined;
    index = updateIndex(index, args, envelope, audit, stale, workspace.revision);
    atomicWriteJson(paths.indexPath, index);
    if (args.action === 'validate') atomicWriteJson(paths.auditPath, audit);
    return successResponse(JSON.stringify(buildResult(paths, envelope, audit, index, stale), null, 2));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function findUpstreamReadinessError(index: InvestmentCapabilityIndex, capability: InvestmentCapabilityId): string | undefined {
  for (const dependency of getInvestmentCapabilityDependencies(capability)) {
    if (dependency === 'core') continue;
    const entry = index.capabilities.find((candidate) => candidate.capability === dependency);
    if (!entry || entry.revision === 0 || entry.readiness !== 'ready' || entry.stale) {
      return `Investment capability ${capability} requires ready upstream capability ${dependency}.`;
    }
  }
  return undefined;
}

function buildUpstream(index: InvestmentCapabilityIndex, capability: InvestmentCapabilityId, coreRevision: number) {
  const revisions = new Map(index.capabilities.map((entry) => [entry.capability, entry.revision]));
  return getInvestmentCapabilityDependencies(capability).map((dependency) => ({
    capability: dependency,
    revision: dependency === 'core' ? coreRevision : (revisions.get(dependency) ?? 0),
  }));
}

function updateIndex(
  index: InvestmentCapabilityIndex,
  args: InvestmentCapabilityArgs,
  envelope: InvestmentCapabilityEnvelope,
  audit: InvestmentCapabilityAudit,
  stale: boolean,
  coreRevision: number,
): InvestmentCapabilityIndex {
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

function upsertIndexEntry(index: InvestmentCapabilityIndex, entry: InvestmentCapabilityIndexEntry, coreRevision: number): InvestmentCapabilityIndex {
  const entries = new Map(index.capabilities.map((current) => [current.capability, current]));
  entries.set(entry.capability, entry);
  return parseInvestmentCapabilityIndex({ ...index, coreRevision, capabilities: [...entries.values()] });
}

function readIndex(indexPath: string, projectId: string, coreRevision: number): InvestmentCapabilityIndex {
  if (!existsSync(indexPath)) return { schemaVersion: 1, projectId, coreRevision, capabilities: [] };
  return parseInvestmentCapabilityIndex(JSON.parse(readFileSync(indexPath, 'utf8')));
}

function resolvePaths(workingDirectory: string, projectId: string, capability: InvestmentCapabilityId) {
  const projectDirectory = resolve(workingDirectory, '.agent-pi', 'business', 'investment', projectId);
  const fileName = CAPABILITY_FILES[capability];
  return {
    projectDirectory,
    corePath: join(projectDirectory, 'investment-workspace.json'),
    indexPath: join(projectDirectory, 'capability-index.json'),
    modelPath: join(projectDirectory, 'packs', `${fileName}.json`),
    auditPath: join(projectDirectory, 'audits', `${fileName}-audit.json`),
  };
}

function buildResult(
  paths: ReturnType<typeof resolvePaths>, envelope: InvestmentCapabilityEnvelope,
  audit: InvestmentCapabilityAudit, index: InvestmentCapabilityIndex, stale: boolean,
) {
  return {
    envelope, audit, stale, effectiveReadiness: stale ? 'not_ready' : audit.readiness,
    indexEntry: index.capabilities.find((entry) => entry.capability === envelope.capability),
    modelPath: paths.modelPath, auditPath: paths.auditPath, indexPath: paths.indexPath,
  };
}

function persist(
  paths: ReturnType<typeof resolvePaths>, envelope: InvestmentCapabilityEnvelope,
  audit: InvestmentCapabilityAudit, index: InvestmentCapabilityIndex,
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
