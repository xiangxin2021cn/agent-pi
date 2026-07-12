import { describe, expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import { extractTenderSubmissionEvidence, extractTenderWorkspaceEvidence } from './tender-workspace-evidence.ts';

function toolMessage(
  id: string,
  toolResult: string,
  toolStatus: Message['toolStatus'] = 'completed',
  toolName = 'tender_workspace',
): Message {
  return {
    id,
    role: 'tool',
    content: toolResult,
    timestamp: 1,
    toolName,
    toolStatus,
    toolResult,
  };
}

function payload(readiness: 'not_ready' | 'needs_review' | 'ready', revision = 3): string {
  return JSON.stringify({
    workspace: { revision, project: { id: 'n3-upgrade' } },
    audit: {
      projectId: 'n3-upgrade',
      workspaceRevision: revision,
      readiness,
      issues: readiness === 'ready' ? [] : [{ code: 'mandatory_requirement_uncovered' }],
    },
    modelPath: 'C:/project/.agent-pi/business/tender/n3-upgrade/tender-workspace.json',
    auditPath: 'C:/project/.agent-pi/business/tender/n3-upgrade/readiness-audit.json',
  });
}

describe('extractTenderWorkspaceEvidence', () => {
  test('extracts the latest valid tender readiness payload', () => {
    const result = extractTenderWorkspaceEvidence([
      toolMessage('t1', payload('not_ready', 2)),
      toolMessage('t2', payload('ready', 3)),
    ]);

    expect(result).toEqual(expect.objectContaining({
      status: 'valid',
      projectId: 'n3-upgrade',
      revision: 3,
      readiness: 'ready',
    }));
  });

  test('reports malformed successful tool output', () => {
    const result = extractTenderWorkspaceEvidence([toolMessage('t1', 'not-json')]);
    expect(result?.status).toBe('malformed');
  });

  test('reports a stale audit revision', () => {
    const stale = JSON.parse(payload('ready', 3));
    stale.audit.workspaceRevision = 2;
    const result = extractTenderWorkspaceEvidence([toolMessage('t1', JSON.stringify(stale))]);
    expect(result?.status).toBe('stale');
  });

  test('ignores failed tender workspace calls', () => {
    const result = extractTenderWorkspaceEvidence([
      toolMessage('t1', '[ERROR] invalid reference', 'error'),
    ]);
    expect(result).toBeUndefined();
  });
});

describe('extractTenderSubmissionEvidence', () => {
  test('extracts a valid submission audit capability payload', () => {
    const result = extractTenderSubmissionEvidence([
      toolMessage('t1', JSON.stringify({
        envelope: { capability: 'submission_audit', projectId: 'n3-upgrade', revision: 2, coreRevision: 3 },
        audit: { capability: 'submission_audit', projectId: 'n3-upgrade', coreRevision: 3, readiness: 'ready', issues: [] },
        stale: false,
        effectiveReadiness: 'ready',
        modelPath: 'C:/project/packs/submission-audit.json',
        auditPath: 'C:/project/audits/submission-audit-audit.json',
      }), 'completed', 'tender_capability'),
    ]);

    expect(result).toEqual(expect.objectContaining({
      status: 'valid',
      projectId: 'n3-upgrade',
      revision: 2,
      readiness: 'ready',
      stale: false,
    }));
  });

  test('rejects stale submission audit capability evidence', () => {
    const result = extractTenderSubmissionEvidence([
      toolMessage('t1', JSON.stringify({
        envelope: { capability: 'submission_audit', projectId: 'n3-upgrade', revision: 2, coreRevision: 3 },
        audit: { capability: 'submission_audit', projectId: 'n3-upgrade', coreRevision: 3, readiness: 'ready', issues: [] },
        stale: true,
        effectiveReadiness: 'not_ready',
        modelPath: 'C:/project/packs/submission-audit.json',
        auditPath: 'C:/project/audits/submission-audit-audit.json',
      }), 'completed', 'tender_capability'),
    ]);

    expect(result?.status).toBe('stale');
  });
});
