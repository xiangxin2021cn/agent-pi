import {
  auditDeliveryWorkspace,
  parseDeliveryWorkspace,
  type DeliveryBaseline,
  type DeliveryEvidenceSnapshot,
  type DeliveryKnowledgeUse,
  type DeliveryProject,
  type DeliverySource,
  type DeliveryWorkspace,
} from '@agent-pi/business-core/delivery';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { verifyBusinessEvidenceSnapshots } from '../knowledge-base-business-publication.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';

export type DeliveryWorkspaceAction =
  | 'init'
  | 'upsert_sources'
  | 'upsert_snapshots'
  | 'upsert_baselines'
  | 'upsert_knowledge_uses'
  | 'status'
  | 'validate';

export interface DeliveryWorkspaceArgs {
  action: DeliveryWorkspaceAction;
  projectId: string;
  project?: DeliveryProject;
  sources?: DeliverySource[];
  snapshots?: DeliveryEvidenceSnapshot[];
  baselines?: DeliveryBaseline[];
  knowledgeUses?: DeliveryKnowledgeUse[];
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function handleDeliveryWorkspace(ctx: SessionToolContext, args: DeliveryWorkspaceArgs) {
  try {
    if (!ctx.workingDirectory) return errorResponse('delivery_workspace requires an explicit session working directory.');
    if (!SAFE_PROJECT_ID.test(args.projectId)) return errorResponse('projectId must be a filesystem-safe identifier.');
    mkdirSync(ctx.workingDirectory, { recursive: true });
    const projectDirectory = resolve(ctx.workingDirectory, '.agent-pi', 'business', 'delivery', args.projectId);
    if (!isPathWithinDirectoryForCreation(projectDirectory, ctx.workingDirectory)) {
      return errorResponse('Resolved delivery project path escapes the session working directory.');
    }
    const modelPath = join(projectDirectory, 'delivery-workspace.json');
    const auditPath = join(projectDirectory, 'readiness-audit.json');

    if (args.action === 'init') {
      if (!args.project) return errorResponse('init requires project.');
      if (args.project.id !== args.projectId) return errorResponse('project.id must match projectId.');
      if (existsSync(modelPath)) return errorResponse(`Delivery workspace ${args.projectId} already exists.`);
      const workspace = parseDeliveryWorkspace({
        schemaVersion: 1,
        revision: 1,
        project: args.project,
        sources: [],
        snapshots: [],
        baselines: [],
        knowledgeUses: [],
      });
      return persistAndRespond(projectDirectory, modelPath, auditPath, workspace);
    }

    if (!existsSync(modelPath)) return errorResponse(`Delivery workspace ${args.projectId} does not exist. Call init first.`);
    const current = parseDeliveryWorkspace(JSON.parse(readFileSync(modelPath, 'utf8')));
    if (args.action === 'status') return successResponse(JSON.stringify(buildResult(current, modelPath, auditPath), null, 2));
    if (args.action === 'validate') {
      const audit = auditDeliveryWorkspace(current);
      atomicWriteJson(auditPath, audit);
      return successResponse(JSON.stringify({ workspace: current, audit, modelPath, auditPath }, null, 2));
    }

    const candidate = parseDeliveryWorkspace(applyUpsert(current, args));
    if (args.action === 'upsert_snapshots') {
      if (!ctx.knowledgeBaseRegistryRootPath) return errorResponse('upsert_snapshots requires the global knowledge base registry root.');
      verifyBusinessEvidenceSnapshots(ctx.knowledgeBaseRegistryRootPath, candidate.snapshots);
    }
    return persistAndRespond(projectDirectory, modelPath, auditPath, candidate);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function applyUpsert(workspace: DeliveryWorkspace, args: DeliveryWorkspaceArgs): DeliveryWorkspace {
  const next = { ...workspace, revision: workspace.revision + 1 };
  switch (args.action) {
    case 'upsert_sources':
      if (!args.sources) throw new Error('upsert_sources requires sources.');
      return { ...next, sources: upsertById(workspace.sources, args.sources) };
    case 'upsert_snapshots':
      if (!args.snapshots) throw new Error('upsert_snapshots requires snapshots.');
      return { ...next, snapshots: upsertById(workspace.snapshots, args.snapshots) };
    case 'upsert_baselines':
      if (!args.baselines) throw new Error('upsert_baselines requires baselines.');
      return { ...next, baselines: upsertById(workspace.baselines, args.baselines) };
    case 'upsert_knowledge_uses':
      if (!args.knowledgeUses) throw new Error('upsert_knowledge_uses requires knowledgeUses.');
      return { ...next, knowledgeUses: upsertByKey(workspace.knowledgeUses, args.knowledgeUses, (item) => item.publicationId) };
    default:
      throw new Error(`Unsupported delivery workspace action: ${args.action}`);
  }
}

function upsertById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return upsertByKey(current, incoming, (item) => item.id);
}

function upsertByKey<T>(current: T[], incoming: T[], key: (item: T) => string): T[] {
  const merged = new Map(current.map((item) => [key(item), item]));
  for (const item of incoming) merged.set(key(item), item);
  return [...merged.values()];
}

function persistAndRespond(projectDirectory: string, modelPath: string, auditPath: string, workspace: DeliveryWorkspace) {
  const audit = auditDeliveryWorkspace(workspace);
  mkdirSync(projectDirectory, { recursive: true });
  atomicWriteJson(modelPath, workspace);
  atomicWriteJson(auditPath, audit);
  return successResponse(JSON.stringify({ workspace, audit, modelPath, auditPath }, null, 2));
}

function buildResult(workspace: DeliveryWorkspace, modelPath: string, auditPath: string) {
  return { workspace, audit: auditDeliveryWorkspace(workspace), modelPath, auditPath };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
