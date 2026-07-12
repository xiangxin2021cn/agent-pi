import {
  auditDeliveryWorkspace,
  parseDeliveryCapabilityEnvelope,
  parseDeliveryCapabilityIndex,
  parseDeliveryWorkspace,
  type DeliveryCapabilityId,
} from '@agent-pi/business-core/delivery';
import { RPC_CHANNELS, type DeliveryWorkspaceBundleDto, type DeliveryWorkspaceSummaryDto } from '@craft-agent/shared/protocol';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  createNodeFileSystem,
  handleDeliveryCapability,
  handleDeliveryWorkspace,
  type SessionToolContext,
  type ToolResult,
} from '@craft-agent/session-tools-core';
import type { RpcServer } from '../../transport/types.ts';

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

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.deliveryWorkspace.LIST,
  RPC_CHANNELS.deliveryWorkspace.GET,
  RPC_CHANNELS.deliveryWorkspace.MUTATE,
] as const;

export function registerDeliveryWorkspaceHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.deliveryWorkspace.LIST, async (_ctx, request: { workingDirectory: string }) => {
    return listDeliveryWorkspaces(request.workingDirectory);
  });
  server.handle(RPC_CHANNELS.deliveryWorkspace.GET, async (_ctx, request: { workingDirectory: string; projectId: string }) => {
    return readDeliveryWorkspaceBundle(request.workingDirectory, request.projectId);
  });
  server.handle(RPC_CHANNELS.deliveryWorkspace.MUTATE, async (_ctx, request: {
    workingDirectory: string;
    target: 'workspace' | 'capability';
    args: Record<string, unknown>;
  }) => {
    assertWorkingDirectory(request.workingDirectory);
    const context = createDeliveryToolContext(request.workingDirectory);
    const result = request.target === 'workspace'
      ? await handleDeliveryWorkspace(context, request.args as never)
      : await handleDeliveryCapability(context, request.args as never);
    if (result.isError) throw new Error(result.content.map((block) => block.text).join('\n'));
    return parseToolResult(result);
  });
}

export function listDeliveryWorkspaces(workingDirectory: string): DeliveryWorkspaceSummaryDto[] {
  assertWorkingDirectory(workingDirectory);
  const root = deliveryRoot(workingDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_PROJECT_ID.test(entry.name))
    .flatMap((entry) => {
      try {
        const modelPath = join(root, entry.name, 'delivery-workspace.json');
        if (!existsSync(modelPath)) return [];
        const workspace = parseDeliveryWorkspace(readJson(modelPath));
        const audit = auditDeliveryWorkspace(workspace);
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
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function readDeliveryWorkspaceBundle(workingDirectory: string, projectId: string): DeliveryWorkspaceBundleDto {
  assertWorkingDirectory(workingDirectory);
  if (!SAFE_PROJECT_ID.test(projectId)) throw new Error('Invalid delivery project ID.');
  const projectDirectory = join(deliveryRoot(workingDirectory), projectId);
  const modelPath = join(projectDirectory, 'delivery-workspace.json');
  if (!existsSync(modelPath)) throw new Error(`Delivery workspace ${projectId} does not exist.`);
  const workspace = parseDeliveryWorkspace(readJson(modelPath));
  if (workspace.project.id !== projectId) throw new Error('Delivery workspace project ID does not match its directory.');
  const audit = auditDeliveryWorkspace(workspace);
  const indexPath = join(projectDirectory, 'capability-index.json');
  const capabilityIndex = existsSync(indexPath)
    ? parseDeliveryCapabilityIndex(readJson(indexPath))
    : { schemaVersion: 1 as const, projectId, coreRevision: workspace.revision, capabilities: [] };
  const packs: Record<string, Record<string, unknown>> = {};
  const packAudits: Record<string, Record<string, unknown>> = {};
  for (const [capability, fileName] of Object.entries(CAPABILITY_FILES)) {
    const packPath = join(projectDirectory, 'packs', `${fileName}.json`);
    const packAuditPath = join(projectDirectory, 'audits', `${fileName}-audit.json`);
    if (existsSync(packPath)) packs[capability] = parseDeliveryCapabilityEnvelope(readJson(packPath)) as unknown as Record<string, unknown>;
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

function createDeliveryToolContext(workingDirectory: string): SessionToolContext {
  return {
    sessionId: 'delivery-workspace-rpc',
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

function deliveryRoot(workingDirectory: string): string {
  return join(resolve(workingDirectory), '.agent-pi', 'business', 'delivery');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function parseToolResult(result: ToolResult): Record<string, unknown> {
  const text = result.content.map((block) => block.text).join('\n');
  return JSON.parse(text) as Record<string, unknown>;
}
