import {
  auditInvestmentWorkspace, parseInvestmentCapabilityEnvelope, parseInvestmentCapabilityIndex,
  parseInvestmentWorkspace, type InvestmentCapabilityId,
} from '@agent-pi/business-core/investment';
import { RPC_CHANNELS, type InvestmentWorkspaceBundleDto, type InvestmentWorkspaceSummaryDto } from '@craft-agent/shared/protocol';
import { CONFIG_DIR } from '@craft-agent/shared/config';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  createNodeFileSystem, handleInvestmentCapability, handleInvestmentWorkspace,
  type SessionToolContext, type ToolResult,
} from '@craft-agent/session-tools-core';
import type { RpcServer } from '../../transport/types.ts';

const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CAPABILITY_FILES: Record<InvestmentCapabilityId, string> = {
  mandate_screening: 'mandate-screening', resource_technical: 'resource-technical',
  market_offtake: 'market-offtake', legal_esg: 'legal-esg',
  financial_valuation: 'financial-valuation', transaction_decision: 'transaction-decision',
};

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.investmentWorkspace.LIST,
  RPC_CHANNELS.investmentWorkspace.GET,
  RPC_CHANNELS.investmentWorkspace.MUTATE,
] as const;

export function registerInvestmentWorkspaceHandlers(server: RpcServer): void {
  server.handle(RPC_CHANNELS.investmentWorkspace.LIST, async (_ctx, request: { workingDirectory: string }) => listInvestmentWorkspaces(request.workingDirectory));
  server.handle(RPC_CHANNELS.investmentWorkspace.GET, async (_ctx, request: { workingDirectory: string; projectId: string }) => readInvestmentWorkspaceBundle(request.workingDirectory, request.projectId));
  server.handle(RPC_CHANNELS.investmentWorkspace.MUTATE, async (_ctx, request: { workingDirectory: string; target: 'workspace' | 'capability'; args: Record<string, unknown> }) => {
    assertWorkingDirectory(request.workingDirectory);
    const context = createInvestmentToolContext(request.workingDirectory);
    const result = request.target === 'workspace'
      ? await handleInvestmentWorkspace(context, request.args as never)
      : await handleInvestmentCapability(context, request.args as never);
    if (result.isError) throw new Error(result.content.map((block) => block.text).join('\n'));
    return parseToolResult(result);
  });
}

export function listInvestmentWorkspaces(workingDirectory: string): InvestmentWorkspaceSummaryDto[] {
  assertWorkingDirectory(workingDirectory);
  const root = investmentRoot(workingDirectory);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_PROJECT_ID.test(entry.name))
    .flatMap((entry) => {
      try {
        const modelPath = join(root, entry.name, 'investment-workspace.json');
        if (!existsSync(modelPath)) return [];
        const workspace = parseInvestmentWorkspace(readJson(modelPath));
        const audit = auditInvestmentWorkspace(workspace);
        return [{
          projectId: workspace.project.id, title: workspace.project.title, stage: workspace.project.stage,
          status: workspace.project.status, revision: workspace.revision,
          readiness: audit.readiness, issueCount: audit.issues.length,
        }];
      } catch { return []; }
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function readInvestmentWorkspaceBundle(workingDirectory: string, projectId: string): InvestmentWorkspaceBundleDto {
  assertWorkingDirectory(workingDirectory);
  if (!SAFE_PROJECT_ID.test(projectId)) throw new Error('Invalid investment project ID.');
  const projectDirectory = join(investmentRoot(workingDirectory), projectId);
  const modelPath = join(projectDirectory, 'investment-workspace.json');
  if (!existsSync(modelPath)) throw new Error(`Investment workspace ${projectId} does not exist.`);
  const workspace = parseInvestmentWorkspace(readJson(modelPath));
  if (workspace.project.id !== projectId) throw new Error('Investment workspace project ID does not match its directory.');
  const audit = auditInvestmentWorkspace(workspace);
  const indexPath = join(projectDirectory, 'capability-index.json');
  const capabilityIndex = existsSync(indexPath)
    ? parseInvestmentCapabilityIndex(readJson(indexPath))
    : { schemaVersion: 1 as const, projectId, coreRevision: workspace.revision, capabilities: [] };
  const packs: Record<string, Record<string, unknown>> = {};
  const packAudits: Record<string, Record<string, unknown>> = {};
  for (const [capability, fileName] of Object.entries(CAPABILITY_FILES)) {
    const packPath = join(projectDirectory, 'packs', `${fileName}.json`);
    const packAuditPath = join(projectDirectory, 'audits', `${fileName}-audit.json`);
    if (existsSync(packPath)) packs[capability] = parseInvestmentCapabilityEnvelope(readJson(packPath)) as unknown as Record<string, unknown>;
    if (existsSync(packAuditPath)) packAudits[capability] = readJson(packAuditPath);
  }
  return {
    workspace: workspace as unknown as Record<string, unknown>, audit: audit as unknown as Record<string, unknown>,
    capabilityIndex: capabilityIndex as unknown as Record<string, unknown>, packs, packAudits,
    paths: {
      projectDirectory, modelPath, auditPath: join(projectDirectory, 'readiness-audit.json'), indexPath,
    },
  };
}

function createInvestmentToolContext(workingDirectory: string): SessionToolContext {
  return {
    sessionId: 'investment-workspace-rpc', workspacePath: workingDirectory,
    sourcesPath: join(workingDirectory, '.agent-pi', 'sources'), skillsPath: join(workingDirectory, '.agent-pi', 'skills'),
    plansFolderPath: join(workingDirectory, '.agent-pi', 'plans'), workingDirectory,
    knowledgeBaseRegistryRootPath: CONFIG_DIR,
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} }, fs: createNodeFileSystem(), loadSourceConfig: () => null,
  };
}

function assertWorkingDirectory(workingDirectory: string): void {
  if (!workingDirectory || !isAbsolute(workingDirectory)) throw new Error('An absolute working directory is required.');
}

function investmentRoot(workingDirectory: string): string {
  return resolve(workingDirectory, '.agent-pi', 'business', 'investment');
}

function readJson(path: string): Record<string, unknown> { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; }
function parseToolResult(result: ToolResult): Record<string, unknown> {
  const text = result.content.find((block) => block.type === 'text')?.text;
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}
