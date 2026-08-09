import {
  auditTenderWorkspace,
  parseTenderWorkspace,
  type TenderDeliverable,
  type TenderDocument,
  type TenderEvaluationCriterion,
  type TenderProject,
  type TenderRequirement,
  type TenderResponsePlan,
  type TenderWorkspace,
} from '@agent-pi/business-core/tender';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import { isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';
import { requireContextWorkingDirectory } from '../working-directory.ts';

export type TenderWorkspaceAction =
  | 'init'
  | 'upsert_documents'
  | 'upsert_requirements'
  | 'upsert_criteria'
  | 'upsert_deliverables'
  | 'upsert_responses'
  | 'status'
  | 'validate';

export interface TenderWorkspaceArgs {
  action: TenderWorkspaceAction;
  projectId: string;
  project?: TenderProject;
  documents?: TenderDocument[];
  requirements?: TenderRequirement[];
  criteria?: TenderEvaluationCriterion[];
  deliverables?: TenderDeliverable[];
  responses?: TenderResponsePlan[];
}

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BLOCKING_REFERENCE_CODES = new Set(['broken_document_reference', 'broken_entity_reference']);

export async function handleTenderWorkspace(
  ctx: SessionToolContext,
  args: TenderWorkspaceArgs,
) {
  try {
    const workingDirectory = requireContextWorkingDirectory(ctx, 'tender_workspace');
    if (typeof workingDirectory !== 'string') return workingDirectory;
    if (!SAFE_PROJECT_ID.test(args.projectId)) {
      return errorResponse('projectId must be a filesystem-safe identifier.');
    }

    mkdirSync(workingDirectory, { recursive: true });
    const projectDirectory = resolve(
      workingDirectory,
      '.agent-pi',
      'business',
      'tender',
      args.projectId,
    );
    if (!isPathWithinDirectoryForCreation(projectDirectory, workingDirectory)) {
      return errorResponse('Resolved tender project path escapes the session working directory.');
    }

    const modelPath = join(projectDirectory, 'tender-workspace.json');
    const auditPath = join(projectDirectory, 'readiness-audit.json');

    if (args.action === 'init') {
      if (!args.project) return errorResponse('init requires project.');
      if (args.project.id !== args.projectId) {
        return errorResponse('project.id must match projectId.');
      }
      if (existsSync(modelPath)) {
        return errorResponse(`Tender workspace ${args.projectId} already exists.`);
      }
      const workspace = parseTenderWorkspace({
        schemaVersion: 1,
        revision: 1,
        project: args.project,
        documents: [],
        requirements: [],
        criteria: [],
        deliverables: [],
        responses: [],
      });
      return persistAndRespond(projectDirectory, modelPath, auditPath, workspace);
    }

    if (!existsSync(modelPath)) {
      return errorResponse(`Tender workspace ${args.projectId} does not exist. Call init first.`);
    }
    const current = parseTenderWorkspace(JSON.parse(readFileSync(modelPath, 'utf8')));

    if (args.action === 'status') {
      return successResponse(JSON.stringify(buildResult(current, modelPath, auditPath), null, 2));
    }
    if (args.action === 'validate') {
      const audit = auditTenderWorkspace(current);
      mkdirSync(projectDirectory, { recursive: true });
      atomicWriteJson(auditPath, audit);
      return successResponse(JSON.stringify({ workspace: current, audit, modelPath, auditPath }, null, 2));
    }

    const candidate = parseTenderWorkspace(applyUpsert(current, args));
    const referenceIssues = auditTenderWorkspace(candidate).issues.filter((issue) =>
      BLOCKING_REFERENCE_CODES.has(issue.code),
    );
    if (referenceIssues.length > 0) {
      return errorResponse(`Tender workspace has invalid references: ${JSON.stringify(referenceIssues)}`);
    }
    return persistAndRespond(projectDirectory, modelPath, auditPath, candidate);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

function applyUpsert(workspace: TenderWorkspace, args: TenderWorkspaceArgs): TenderWorkspace {
  const next: TenderWorkspace = { ...workspace, revision: workspace.revision + 1 };
  switch (args.action) {
    case 'upsert_documents':
      if (!args.documents) throw new Error('upsert_documents requires documents.');
      return { ...next, documents: upsertById(workspace.documents, args.documents) };
    case 'upsert_requirements':
      if (!args.requirements) throw new Error('upsert_requirements requires requirements.');
      return { ...next, requirements: upsertById(workspace.requirements, args.requirements) };
    case 'upsert_criteria':
      if (!args.criteria) throw new Error('upsert_criteria requires criteria.');
      return { ...next, criteria: upsertById(workspace.criteria, args.criteria) };
    case 'upsert_deliverables':
      if (!args.deliverables) throw new Error('upsert_deliverables requires deliverables.');
      return { ...next, deliverables: upsertById(workspace.deliverables, args.deliverables) };
    case 'upsert_responses':
      if (!args.responses) throw new Error('upsert_responses requires responses.');
      return { ...next, responses: upsertById(workspace.responses, args.responses) };
    default:
      throw new Error(`Unsupported tender workspace action: ${args.action}`);
  }
}

function upsertById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const merged = new Map(current.map((entity) => [entity.id, entity]));
  for (const entity of incoming) merged.set(entity.id, entity);
  return [...merged.values()];
}

function persistAndRespond(
  projectDirectory: string,
  modelPath: string,
  auditPath: string,
  workspace: TenderWorkspace,
) {
  const audit = auditTenderWorkspace(workspace);
  mkdirSync(projectDirectory, { recursive: true });
  atomicWriteJson(modelPath, workspace);
  atomicWriteJson(auditPath, audit);
  return successResponse(JSON.stringify({ workspace, audit, modelPath, auditPath }, null, 2));
}

function buildResult(workspace: TenderWorkspace, modelPath: string, auditPath: string) {
  return {
    workspace,
    audit: auditTenderWorkspace(workspace),
    modelPath,
    auditPath,
  };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}
