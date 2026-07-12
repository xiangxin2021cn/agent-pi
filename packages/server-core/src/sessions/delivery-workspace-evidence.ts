import type { Message } from '@craft-agent/core/types';

export type DeliveryWorkspaceEvidenceStatus = 'valid' | 'malformed' | 'stale';
export type DeliveryWorkspaceReadiness = 'not_ready' | 'needs_review' | 'ready';

export interface DeliveryWorkspaceEvidence {
  status: DeliveryWorkspaceEvidenceStatus;
  projectId?: string;
  revision?: number;
  readiness?: DeliveryWorkspaceReadiness;
  issueCodes: string[];
  modelPath?: string;
  auditPath?: string;
  error?: string;
}

export interface DeliveryReportingEvidence extends DeliveryWorkspaceEvidence {
  coreRevision?: number;
  stale?: boolean;
}

export function extractDeliveryWorkspaceEvidence(messages: readonly Message[]): DeliveryWorkspaceEvidence | undefined {
  const message = [...messages].reverse().find((candidate) =>
    candidate.role === 'tool'
    && normalizeToolName(candidate.toolName).endsWith('delivery_workspace')
    && candidate.toolStatus !== 'error'
    && !candidate.toolResult?.startsWith('[ERROR]'),
  );
  if (!message) return undefined;
  try {
    const value = parseJsonObject(message.toolResult ?? message.content);
    const workspace = asRecord(value.workspace);
    const project = asRecord(workspace.project);
    const audit = asRecord(value.audit);
    const revision = asNumber(workspace.revision);
    const auditRevision = asNumber(audit.workspaceRevision);
    const projectId = asString(audit.projectId) ?? asString(project.id);
    const readiness = asReadiness(audit.readiness);
    const modelPath = asString(value.modelPath);
    const auditPath = asString(value.auditPath);
    const issueCodes = extractIssueCodes(audit);
    if (!projectId || revision === undefined || auditRevision === undefined || !readiness || !modelPath || !auditPath) {
      return { status: 'malformed', issueCodes, error: 'Delivery workspace result is missing required readiness fields.' };
    }
    if (revision !== auditRevision) {
      return { status: 'stale', projectId, revision, readiness, issueCodes, modelPath, auditPath, error: `Audit revision ${auditRevision} does not match workspace revision ${revision}.` };
    }
    return { status: 'valid', projectId, revision, readiness, issueCodes, modelPath, auditPath };
  } catch (error) {
    return { status: 'malformed', issueCodes: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function extractDeliveryReportingEvidence(messages: readonly Message[]): DeliveryReportingEvidence | undefined {
  const message = [...messages].reverse().find((candidate) => {
    if (candidate.role !== 'tool' || !normalizeToolName(candidate.toolName).endsWith('delivery_capability')) return false;
    if (candidate.toolStatus === 'error' || candidate.toolResult?.startsWith('[ERROR]')) return false;
    try {
      const value = parseJsonObject(candidate.toolResult ?? candidate.content);
      return asString(asRecord(value.envelope).capability) === 'reporting_audit';
    } catch {
      return false;
    }
  });
  if (!message) return undefined;
  try {
    const value = parseJsonObject(message.toolResult ?? message.content);
    const envelope = asRecord(value.envelope);
    const audit = asRecord(value.audit);
    const projectId = asString(envelope.projectId);
    const revision = asNumber(envelope.revision);
    const coreRevision = asNumber(envelope.coreRevision);
    const auditCoreRevision = asNumber(audit.coreRevision);
    const readiness = asReadiness(value.effectiveReadiness) ?? asReadiness(audit.readiness);
    const stale = value.stale === true;
    const modelPath = asString(value.modelPath);
    const auditPath = asString(value.auditPath);
    const issueCodes = extractIssueCodes(audit);
    if (!projectId || revision === undefined || coreRevision === undefined || auditCoreRevision === undefined || !readiness || !modelPath || !auditPath) {
      return { status: 'malformed', issueCodes, error: 'Delivery reporting audit result is missing required readiness fields.' };
    }
    if (coreRevision !== auditCoreRevision) {
      return { status: 'stale', projectId, revision, coreRevision, readiness, stale: true, issueCodes, modelPath, auditPath, error: `Reporting audit core revision ${auditCoreRevision} does not match envelope core revision ${coreRevision}.` };
    }
    if (stale) {
      return { status: 'stale', projectId, revision, coreRevision, readiness, stale, issueCodes, modelPath, auditPath, error: 'Delivery reporting audit capability is stale.' };
    }
    return { status: 'valid', projectId, revision, coreRevision, readiness, stale, issueCodes, modelPath, auditPath };
  } catch (error) {
    return { status: 'malformed', issueCodes: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeToolName(toolName: string | undefined): string {
  return toolName?.toLowerCase().replace(/-/g, '_') ?? '';
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('Delivery workspace result is not JSON.');
  return asRecord(JSON.parse(candidate));
}

function extractIssueCodes(audit: Record<string, unknown>): string[] {
  return Array.isArray(audit.issues)
    ? audit.issues.flatMap((issue) => {
      const code = asString(asRecord(issue).code);
      return code ? [code] : [];
    })
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asReadiness(value: unknown): DeliveryWorkspaceReadiness | undefined {
  return value === 'not_ready' || value === 'needs_review' || value === 'ready' ? value : undefined;
}
