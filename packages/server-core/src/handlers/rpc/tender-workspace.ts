import {
  auditTenderWorkspace,
  parseTenderCapabilityEnvelope,
  parseTenderCapabilityIndex,
  parseTenderWorkspace,
  type TenderCapabilityId,
} from '@agent-pi/business-core/tender';
import { RPC_CHANNELS, type TenderWorkspaceBundleDto, type TenderWorkspaceSummaryDto } from '@craft-agent/shared/protocol';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  createNodeFileSystem,
  handleTenderCapability,
  handleTenderWorkspace,
  type SessionToolContext,
  type ToolResult,
} from '@craft-agent/session-tools-core';
import type { RpcServer } from '../../transport/types.ts';

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITY_FILES: Record<TenderCapabilityId, string> = {
  document_analysis: 'document-analysis',
  evaluation_strategy: 'evaluation-strategy',
  boq_reconciliation: 'boq-reconciliation',
  boq_five_step_pricing: 'boq-five-step-pricing',
  execution_plan: 'execution-plan',
  schedule_resources: 'schedule-resources',
  cost_cashflow: 'cost-cashflow',
  submission_documents: 'submission-documents',
  submission_audit: 'submission-audit',
};

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tenderWorkspace.LIST,
  RPC_CHANNELS.tenderWorkspace.GET,
  RPC_CHANNELS.tenderWorkspace.MUTATE,
] as const;

export function registerTenderWorkspaceHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.tenderWorkspace.LIST, async (_ctx, request: { workingDirectory: string }) => {
    return listTenderWorkspaces(request.workingDirectory);
  });
  server.handle(RPC_CHANNELS.tenderWorkspace.GET, async (_ctx, request: { workingDirectory: string; projectId: string }) => {
    return readTenderWorkspaceBundle(request.workingDirectory, request.projectId);
  });
  server.handle(RPC_CHANNELS.tenderWorkspace.MUTATE, async (_ctx, request: {
    workingDirectory: string;
    target: 'workspace' | 'capability';
    args: Record<string, unknown>;
  }) => {
    assertWorkingDirectory(request.workingDirectory);
    const context = createTenderToolContext(request.workingDirectory);
    const result = request.target === 'workspace'
      ? await handleTenderWorkspace(context, request.args as never)
      : await handleTenderCapability(context, request.args as never);
    if (result.isError) throw new Error(result.content.map((block) => block.text).join('\n'));
    return parseToolResult(result);
  });
}

export function listTenderWorkspaces(workingDirectory: string): TenderWorkspaceSummaryDto[] {
  assertWorkingDirectory(workingDirectory);
  const root = tenderRoot(workingDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_PROJECT_ID.test(entry.name))
    .flatMap((entry) => {
      try {
        const modelPath = join(root, entry.name, 'tender-workspace.json');
        if (!existsSync(modelPath)) return [];
        const workspace = parseTenderWorkspace(readJson(modelPath));
        const audit = auditTenderWorkspace(workspace);
        return [{
          projectId: workspace.project.id,
          title: workspace.project.title,
          reference: workspace.project.reference,
          status: workspace.project.status,
          revision: workspace.revision,
          readiness: audit.readiness,
          issueCount: audit.issues.length,
        }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function readTenderWorkspaceBundle(workingDirectory: string, projectId: string): TenderWorkspaceBundleDto {
  assertWorkingDirectory(workingDirectory);
  if (!SAFE_PROJECT_ID.test(projectId)) throw new Error('Invalid tender project ID.');
  const projectDirectory = join(tenderRoot(workingDirectory), projectId);
  const modelPath = join(projectDirectory, 'tender-workspace.json');
  if (!existsSync(modelPath)) throw new Error(`Tender workspace ${projectId} does not exist.`);
  const workspace = parseTenderWorkspace(readJson(modelPath));
  if (workspace.project.id !== projectId) throw new Error('Tender workspace project ID does not match its directory.');
  const audit = auditTenderWorkspace(workspace);
  const indexPath = join(projectDirectory, 'capability-index.json');
  const capabilityIndex = existsSync(indexPath)
    ? parseTenderCapabilityIndex(readJson(indexPath))
    : { schemaVersion: 1 as const, projectId, coreRevision: workspace.revision, capabilities: [] };
  const packs: Record<string, Record<string, unknown>> = {};
  const packAudits: Record<string, Record<string, unknown>> = {};
  for (const [capability, fileName] of Object.entries(CAPABILITY_FILES)) {
    const packPath = join(projectDirectory, 'packs', `${fileName}.json`);
    const packAuditPath = join(projectDirectory, 'audits', `${fileName}-audit.json`);
    if (existsSync(packPath)) packs[capability] = parseTenderCapabilityEnvelope(readJson(packPath)) as unknown as Record<string, unknown>;
    if (existsSync(packAuditPath)) packAudits[capability] = readJson(packAuditPath);
  }
  const auditPath = join(projectDirectory, 'readiness-audit.json');
  return {
    workspace: workspace as unknown as Record<string, unknown>,
    audit: audit as unknown as Record<string, unknown>,
    capabilityIndex: capabilityIndex as unknown as Record<string, unknown>,
    packs,
    packAudits,
    paths: { projectDirectory, modelPath, auditPath, indexPath },
  };
}

function createTenderToolContext(workingDirectory: string): SessionToolContext {
  return {
    sessionId: 'tender-workspace-rpc',
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

function assertWorkingDirectory(workingDirectory: string): void {
  if (!isAbsolute(workingDirectory)) throw new Error('workingDirectory must be absolute.');
  const resolved = resolve(workingDirectory);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error('workingDirectory does not exist.');
}

function tenderRoot(workingDirectory: string): string {
  return join(resolve(workingDirectory), '.agent-pi', 'business', 'tender');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function parseToolResult(result: ToolResult): Record<string, unknown> {
  const text = result.content.map((block) => block.text).join('\n');
  return JSON.parse(text) as Record<string, unknown>;
}
