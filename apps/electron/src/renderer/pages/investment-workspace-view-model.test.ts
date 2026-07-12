import { describe, expect, test } from 'bun:test';
import { buildInvestmentWorkspaceViewModel } from './investment-workspace-view-model.ts';

describe('investment workspace view model', () => {
  test('maps independent investment capabilities to seven focused tabs', () => {
    const view = buildInvestmentWorkspaceViewModel({
      workspace: {
        schemaVersion: 1, revision: 3,
        project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' },
        sources: [{ id: 'mandate', name: 'Mandate', kind: 'mandate', status: 'active' }], snapshots: [], assumptionSets: [], knowledgeUses: [],
      },
      audit: { readiness: 'ready', issues: [] },
      capabilityIndex: { capabilities: [{ capability: 'mandate_screening', readiness: 'ready', issueCount: 0, stale: false }] },
      packs: { mandate_screening: { data: { findings: [{ id: 'gate', title: 'Stage gate', category: 'stage_gate', status: 'verified' }] } } },
      packAudits: {},
      paths: { projectDirectory: 'C:/project', modelPath: 'C:/project/investment-workspace.json', auditPath: 'C:/project/readiness-audit.json', indexPath: 'C:/project/capability-index.json' },
    });
    expect(view.tabs.map((tab) => tab.id)).toEqual(['sources', 'screening', 'technical', 'market', 'legalEsg', 'valuation', 'decision']);
    expect(view.tabs[1]?.rows[0]?.title).toBe('Stage gate');
    expect(view.stage).toBe('screening');
  });
});
