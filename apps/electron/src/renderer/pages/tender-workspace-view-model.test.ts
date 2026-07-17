import { describe, expect, test } from 'bun:test';
import { buildTenderWorkspaceViewModel } from './tender-workspace-view-model.ts';

describe('Tender Workspace view model', () => {
  test('maps the structured workspace and tender capability packs into operational tabs', () => {
    const view = buildTenderWorkspaceViewModel({
      workspace: {
        revision: 7,
        project: { id: 'n3-upgrade', title: 'N3 Upgrade', status: 'active' },
        documents: [{ id: 'spec', name: 'Specification', kind: 'specification', status: 'active' }],
        requirements: [{ id: 'req-1', title: 'Methodology', criticality: 'critical', status: 'compliant' }],
        criteria: [],
        deliverables: [{ id: 'method', title: 'Methodology', status: 'ready' }],
        responses: [],
      },
      audit: { readiness: 'needs_review', issues: [{ code: 'response_delivery_unresolved' }] },
      capabilityIndex: {
        capabilities: [
          { capability: 'document_analysis', readiness: 'ready', stale: false, issueCount: 0 },
          { capability: 'boq_reconciliation', readiness: 'ready', stale: true, issueCount: 0 },
          { capability: 'boq_five_step_pricing', readiness: 'needs_review', stale: false, issueCount: 1 },
          { capability: 'bidder_commitments', readiness: 'ready', stale: false, issueCount: 0 },
        ],
      },
      packs: {
        document_analysis: { data: { sections: [{ id: 'doc-1', title: 'Specification analysis' }] } },
        boq_reconciliation: { data: { items: [{ id: 'boq-1', code: '52.01', description: 'Drain' }] } },
        boq_five_step_pricing: { data: { itemBuildUps: [{ boqItemId: 'boq-1', directCost: '1200' }] } },
        bidder_commitments: { data: { commitments: [{ id: 'plant-1', category: 'plant', subject: 'Plant fleet', status: 'confirmed' }] } },
      },
      packAudits: {},
      paths: { projectDirectory: 'C:/project', modelPath: 'C:/project/model.json', auditPath: 'C:/project/audit.json', indexPath: 'C:/project/index.json' },
    });

    expect(view.tabs.map((tab) => tab.id)).toEqual([
      'sources', 'compliance', 'analysis', 'evaluation', 'boq', 'pricing',
      'commitments', 'execution', 'schedule', 'cost', 'submissionDocuments', 'submission',
    ]);
    expect(view.tabs.find((tab) => tab.id === 'sources')?.count).toBe(1);
    expect(view.tabs.find((tab) => tab.id === 'compliance')?.count).toBe(2);
    expect(view.tabs.find((tab) => tab.id === 'analysis')?.rows[0]?.title).toBe('Specification analysis');
    expect(view.tabs.find((tab) => tab.id === 'boq')?.rows[0]?.title).toContain('52.01');
    expect(view.tabs.find((tab) => tab.id === 'boq')?.stale).toBe(true);
    expect(view.tabs.find((tab) => tab.id === 'pricing')?.rows[0]?.title).toContain('1200');
    expect(view.tabs.find((tab) => tab.id === 'commitments')?.rows[0]?.title).toBe('Plant fleet');
    expect(view.readiness).toBe('needs_review');
  });
});
