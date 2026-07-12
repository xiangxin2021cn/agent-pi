import { describe, expect, test } from 'bun:test';
import { buildDeliveryWorkspaceViewModel } from './delivery-workspace-view-model.ts';

describe('Delivery Workspace view model', () => {
  test('maps the independent workspace and seven delivery packs into eight operational tabs', () => {
    const view = buildDeliveryWorkspaceViewModel({
      workspace: {
        revision: 8,
        project: { id: 'n3-delivery', title: 'N3 Delivery', status: 'active', dataDate: '2026-07-12' },
        sources: [{ id: 'contract', name: 'Contract', kind: 'contract', status: 'active' }],
        snapshots: [],
        baselines: [{ id: 'contract-baseline', title: 'Contract', kind: 'contract', status: 'approved' }],
        knowledgeUses: [],
      },
      audit: { readiness: 'ready', issues: [] },
      capabilityIndex: {
        capabilities: [
          { capability: 'programme_progress', readiness: 'ready', stale: false, issueCount: 0 },
          { capability: 'resource_procurement', readiness: 'needs_review', stale: true, issueCount: 2 },
        ],
      },
      packs: {
        contract_scope: { data: { obligations: [{ id: 'notice', title: 'Notice', status: 'compliant' }], scopeItems: [{ id: 'drainage', title: 'Drainage', wbsCode: '1.1', status: 'reviewed' }] } },
        programme_progress: { data: { activities: [{ id: 'drainage-works', name: 'Drainage works', status: 'in_progress' }], milestones: [] } },
        resource_procurement: { data: { resources: [{ id: 'crew', name: 'Crew', category: 'labour', status: 'confirmed' }], allocations: [], procurementPackages: [] } },
      },
      packAudits: {},
      paths: { projectDirectory: 'C:/project', modelPath: 'C:/project/model.json', auditPath: 'C:/project/audit.json', indexPath: 'C:/project/index.json' },
    });

    expect(view.tabs.map((tab) => tab.id)).toEqual([
      'sources', 'baselines', 'programme', 'resources', 'cost', 'cashflow', 'riskChange', 'reporting',
    ]);
    expect(view.tabs.find((tab) => tab.id === 'sources')?.count).toBe(1);
    expect(view.tabs.find((tab) => tab.id === 'baselines')?.count).toBe(3);
    expect(view.tabs.find((tab) => tab.id === 'programme')?.rows[0]?.title).toBe('Drainage works');
    expect(view.tabs.find((tab) => tab.id === 'resources')?.stale).toBe(true);
    expect(view.tabs.find((tab) => tab.id === 'resources')?.issueCount).toBe(2);
    expect(view.readiness).toBe('ready');
  });
});
