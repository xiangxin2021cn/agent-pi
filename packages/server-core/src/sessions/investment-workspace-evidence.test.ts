import { describe, expect, test } from 'bun:test';
import type { Message } from '@craft-agent/core/types';
import { extractInvestmentDecisionEvidence, extractInvestmentWorkspaceEvidence } from './investment-workspace-evidence.ts';

function toolMessage(toolName: string, toolResult: string): Message {
  return { id: 'tool-1', role: 'tool', content: toolResult, timestamp: 1, toolName, toolStatus: 'completed', toolResult };
}

describe('investment workspace evidence', () => {
  test('extracts current investment core readiness', () => {
    const result = extractInvestmentWorkspaceEvidence([toolMessage('investment_workspace', JSON.stringify({
      workspace: { revision: 3, project: { id: 'quarry-investment' } },
      audit: { projectId: 'quarry-investment', workspaceRevision: 3, readiness: 'ready', issues: [] },
      modelPath: 'C:/project/.agent-pi/business/investment/quarry-investment/investment-workspace.json',
      auditPath: 'C:/project/.agent-pi/business/investment/quarry-investment/readiness-audit.json',
    }))]);
    expect(result).toEqual(expect.objectContaining({ status: 'valid', projectId: 'quarry-investment', revision: 3, readiness: 'ready' }));
  });

  test('extracts a current approved transaction decision pack', () => {
    const result = extractInvestmentDecisionEvidence([toolMessage('investment_capability', JSON.stringify({
      envelope: { capability: 'transaction_decision', projectId: 'quarry-investment', revision: 2, coreRevision: 3 },
      audit: { capability: 'transaction_decision', projectId: 'quarry-investment', coreRevision: 3, readiness: 'ready', summary: { approvedDecisions: 1 }, issues: [] },
      stale: false, effectiveReadiness: 'ready', modelPath: 'C:/decision.json', auditPath: 'C:/decision-audit.json',
    }))]);
    expect(result).toEqual(expect.objectContaining({ status: 'valid', readiness: 'ready', approvedDecisions: 1, stale: false }));
  });
});
