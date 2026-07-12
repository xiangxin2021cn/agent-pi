import type { Message } from '@craft-agent/core/types';

export type TenderWorkspaceEvidenceStatus = 'valid' | 'malformed' | 'stale';
export type TenderWorkspaceReadiness = 'not_ready' | 'needs_review' | 'ready';

export interface TenderWorkspaceEvidence {
  status: TenderWorkspaceEvidenceStatus;
  projectId?: string;
  revision?: number;
  readiness?: TenderWorkspaceReadiness;
  issueCodes: string[];
  modelPath?: string;
  auditPath?: string;
  error?: string;
}

export interface TenderSubmissionEvidence {
  status: TenderWorkspaceEvidenceStatus;
  projectId?: string;
  revision?: number;
  coreRevision?: number;
  readiness?: TenderWorkspaceReadiness;
  stale?: boolean;
  issueCodes: string[];
  modelPath?: string;
  auditPath?: string;
  error?: string;
}

export function extractTenderWorkspaceEvidence(messages: readonly Message[]): TenderWorkspaceEvidence | undefined {
  const message = [...messages].reverse().find((candidate) =>
    candidate.role === 'tool'
    && isTenderWorkspaceTool(candidate.toolName)
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
    const issueCodes = Array.isArray(audit.issues)
      ? audit.issues.flatMap((issue) => {
        const code = asString(asRecord(issue).code);
        return code ? [code] : [];
      })
      : [];

    if (!projectId || revision === undefined || auditRevision === undefined || !readiness || !modelPath || !auditPath) {
      return {
        status: 'malformed',
        issueCodes,
        error: 'Tender workspace result is missing required readiness fields.',
      };
    }
    if (revision !== auditRevision) {
      return {
        status: 'stale',
        projectId,
        revision,
        readiness,
        issueCodes,
        modelPath,
        auditPath,
        error: `Audit revision ${auditRevision} does not match workspace revision ${revision}.`,
      };
    }
    return {
      status: 'valid',
      projectId,
      revision,
      readiness,
      issueCodes,
      modelPath,
      auditPath,
    };
  } catch (error) {
    return {
      status: 'malformed',
      issueCodes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function extractTenderSubmissionEvidence(messages: readonly Message[]): TenderSubmissionEvidence | undefined {
  const message = [...messages].reverse().find((candidate) => {
    if (candidate.role !== 'tool' || !isTenderCapabilityTool(candidate.toolName)) return false;
    if (candidate.toolStatus === 'error' || candidate.toolResult?.startsWith('[ERROR]')) return false;
    try {
      const value = parseJsonObject(candidate.toolResult ?? candidate.content);
      return asString(asRecord(value.envelope).capability) === 'submission_audit';
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
    const issueCodes = Array.isArray(audit.issues)
      ? audit.issues.flatMap((issue) => {
        const code = asString(asRecord(issue).code);
        return code ? [code] : [];
      })
      : [];

    if (!projectId || revision === undefined || coreRevision === undefined || auditCoreRevision === undefined || !readiness || !modelPath || !auditPath) {
      return { status: 'malformed', issueCodes, error: 'Submission audit result is missing required readiness fields.' };
    }
    if (coreRevision !== auditCoreRevision) {
      return {
        status: 'stale', projectId, revision, coreRevision, readiness, stale: true, issueCodes,
        modelPath, auditPath,
        error: `Submission audit core revision ${auditCoreRevision} does not match envelope core revision ${coreRevision}.`,
      };
    }
    if (stale) {
      return {
        status: 'stale', projectId, revision, coreRevision, readiness, stale, issueCodes,
        modelPath, auditPath, error: 'Submission audit capability is stale.',
      };
    }
    return { status: 'valid', projectId, revision, coreRevision, readiness, stale, issueCodes, modelPath, auditPath };
  } catch (error) {
    return {
      status: 'malformed',
      issueCodes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isTenderWorkspaceTool(toolName: string | undefined): boolean {
  return toolName?.toLowerCase().replace(/-/g, '_').endsWith('tender_workspace') ?? false;
}

function isTenderCapabilityTool(toolName: string | undefined): boolean {
  return toolName?.toLowerCase().replace(/-/g, '_').endsWith('tender_capability') ?? false;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidate = trimmed.startsWith('{')
    ? trimmed
    : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('Tender workspace result is not JSON.');
  return asRecord(JSON.parse(candidate));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asReadiness(value: unknown): TenderWorkspaceReadiness | undefined {
  return value === 'not_ready' || value === 'needs_review' || value === 'ready' ? value : undefined;
}
