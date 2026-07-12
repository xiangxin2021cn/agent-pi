import { describe, expect, test } from 'bun:test';
import { buildTenderWorkspaceViewModel } from './tender-workspace-view-model.ts';

describe('Tender Workspace view model', () => {
  test('maps the structured workspace and six capability packs into eight operational tabs', () => {
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
        capabilities: [{ capability: 'boq_reconciliation', readiness: 'ready', stale: true, issueCount: 0 }],
      },
      packs: {
        boq_reconciliation: { data: { items: [{ id: 'boq-1', code: '52.01', description: 'Drain' }] } },
      },
      packAudits: {},
      paths: { projectDirectory: 'C:/project', modelPath: 'C:/project/model.json', auditPath: 'C:/project/audit.json', indexPath: 'C:/project/index.json' },
    });

    expect(view.tabs.map((tab) => tab.id)).toEqual([
      'sources', 'compliance', 'evaluation', 'boq', 'execution', 'schedule', 'cost', 'submission',
    ]);
    expect(view.tabs.find((tab) => tab.id === 'sources')?.count).toBe(1);
    expect(view.tabs.find((tab) => tab.id === 'compliance')?.count).toBe(2);
    expect(view.tabs.find((tab) => tab.id === 'boq')?.rows[0]?.title).toContain('52.01');
    expect(view.tabs.find((tab) => tab.id === 'boq')?.stale).toBe(true);
    expect(view.readiness).toBe('needs_review');
  });
});
