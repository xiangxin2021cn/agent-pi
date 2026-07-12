import type { Message } from '@craft-agent/core/types';

export interface InvestmentWorkspaceEvidence {
  status: 'valid' | 'malformed' | 'stale';
  projectId?: string;
  revision?: number;
  coreRevision?: number;
  readiness?: 'not_ready' | 'needs_review' | 'ready';
  approvedDecisions?: number;
  stale?: boolean;
  issueCodes: string[];
  modelPath?: string;
  auditPath?: string;
  error?: string;
}

export function extractInvestmentWorkspaceEvidence(messages: readonly Message[]): InvestmentWorkspaceEvidence | undefined {
  const message = findToolMessage(messages, 'investment_workspace');
  if (!message) return undefined;
  try {
    const value = parseJsonObject(message.toolResult ?? message.content);
    const workspace = record(value.workspace);
    const audit = record(value.audit);
    const projectId = string(audit.projectId) ?? string(record(workspace.project).id);
    const revision = number(workspace.revision);
    const auditRevision = number(audit.workspaceRevision);
    const readiness = readinessValue(audit.readiness);
    const modelPath = string(value.modelPath);
    const auditPath = string(value.auditPath);
    const issueCodes = extractIssueCodes(audit);
    if (!projectId || revision === undefined || auditRevision === undefined || !readiness || !modelPath || !auditPath) {
      return { status: 'malformed', issueCodes, error: 'Investment workspace result is missing required readiness fields.' };
    }
    if (revision !== auditRevision) return { status: 'stale', projectId, revision, readiness, issueCodes, modelPath, auditPath, error: 'Investment workspace audit revision is stale.' };
    return { status: 'valid', projectId, revision, readiness, issueCodes, modelPath, auditPath };
  } catch (error) { return malformed(error); }
}

export function extractInvestmentDecisionEvidence(messages: readonly Message[]): InvestmentWorkspaceEvidence | undefined {
  const message = [...messages].reverse().find((candidate) => {
    if (!isSuccessfulTool(candidate, 'investment_capability')) return false;
    try { return string(record(parseJsonObject(candidate.toolResult ?? candidate.content).envelope).capability) === 'transaction_decision'; }
    catch { return false; }
  });
  if (!message) return undefined;
  try {
    const value = parseJsonObject(message.toolResult ?? message.content);
    const envelope = record(value.envelope);
    const audit = record(value.audit);
    const projectId = string(envelope.projectId);
    const revision = number(envelope.revision);
    const coreRevision = number(envelope.coreRevision);
    const auditCoreRevision = number(audit.coreRevision);
    const readiness = readinessValue(value.effectiveReadiness) ?? readinessValue(audit.readiness);
    const approvedDecisions = number(record(audit.summary).approvedDecisions);
    const stale = value.stale === true;
    const modelPath = string(value.modelPath);
    const auditPath = string(value.auditPath);
    const issueCodes = extractIssueCodes(audit);
    if (!projectId || revision === undefined || coreRevision === undefined || auditCoreRevision === undefined || !readiness || approvedDecisions === undefined || !modelPath || !auditPath) {
      return { status: 'malformed', issueCodes, error: 'Investment transaction decision result is missing required readiness fields.' };
    }
    if (coreRevision !== auditCoreRevision || stale) {
      return { status: 'stale', projectId, revision, coreRevision, readiness, approvedDecisions, stale: true, issueCodes, modelPath, auditPath, error: 'Investment transaction decision evidence is stale.' };
    }
    return { status: 'valid', projectId, revision, coreRevision, readiness, approvedDecisions, stale, issueCodes, modelPath, auditPath };
  } catch (error) { return malformed(error); }
}

function findToolMessage(messages: readonly Message[], toolName: string): Message | undefined {
  return [...messages].reverse().find((message) => isSuccessfulTool(message, toolName));
}
function isSuccessfulTool(message: Message, toolName: string): boolean {
  return message.role === 'tool' && normalizeToolName(message.toolName).endsWith(toolName)
    && message.toolStatus !== 'error' && !message.toolResult?.startsWith('[ERROR]');
}
function normalizeToolName(value: string | undefined): string { return value?.toLowerCase().replace(/-/g, '_') ?? ''; }
function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('Investment workspace result is not JSON.');
  return record(JSON.parse(candidate));
}
function extractIssueCodes(audit: Record<string, unknown>): string[] {
  return Array.isArray(audit.issues) ? audit.issues.flatMap((value) => { const code = string(record(value).code); return code ? [code] : []; }) : [];
}
function malformed(error: unknown): InvestmentWorkspaceEvidence { return { status: 'malformed', issueCodes: [], error: error instanceof Error ? error.message : String(error) }; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined; }
function readinessValue(value: unknown): InvestmentWorkspaceEvidence['readiness'] { return value === 'not_ready' || value === 'needs_review' || value === 'ready' ? value : undefined; }
