import { describe, expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import { extractDeliveryReportingEvidence, extractDeliveryWorkspaceEvidence } from './delivery-workspace-evidence.ts';

function toolMessage(toolName: string, toolResult: string): Message {
  return { id: 'tool-1', role: 'tool', content: toolResult, timestamp: 1, toolName, toolStatus: 'completed', toolResult };
}

describe('delivery workspace evidence', () => {
  test('extracts current core readiness from delivery_workspace', () => {
    const result = extractDeliveryWorkspaceEvidence([toolMessage('delivery_workspace', JSON.stringify({
      workspace: { revision: 3, project: { id: 'n3-delivery' } },
      audit: { projectId: 'n3-delivery', workspaceRevision: 3, readiness: 'ready', issues: [] },
      modelPath: 'C:/project/.agent-pi/business/delivery/n3-delivery/delivery-workspace.json',
      auditPath: 'C:/project/.agent-pi/business/delivery/n3-delivery/readiness-audit.json',
    }))]);
    expect(result).toEqual(expect.objectContaining({ status: 'valid', projectId: 'n3-delivery', revision: 3, readiness: 'ready' }));
  });

  test('extracts a non-stale reporting_audit capability result', () => {
    const result = extractDeliveryReportingEvidence([toolMessage('delivery_capability', JSON.stringify({
      envelope: { capability: 'reporting_audit', projectId: 'n3-delivery', revision: 2, coreRevision: 3 },
      audit: { capability: 'reporting_audit', projectId: 'n3-delivery', coreRevision: 3, readiness: 'ready', issues: [] },
      stale: false, effectiveReadiness: 'ready',
      modelPath: 'C:/project/.agent-pi/business/delivery/n3-delivery/packs/reporting-audit.json',
      auditPath: 'C:/project/.agent-pi/business/delivery/n3-delivery/audits/reporting-audit-audit.json',
    }))]);
    expect(result).toEqual(expect.objectContaining({ status: 'valid', projectId: 'n3-delivery', readiness: 'ready', stale: false }));
  });
});
