import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { handleDeliveryWorkspace } from './delivery-workspace.ts';

function contractScopeData() {
  return {
    baselineStatus: 'reviewed',
    obligations: [{
      id: 'notice', title: 'Notice requirement', type: 'notice', owner: 'Commercial Manager',
      evidenceRefs: [{ kind: 'source', sourceId: 'contract', clause: '20.1' }], status: 'compliant',
    }],
    scopeItems: [{
      id: 'drainage', wbsCode: '1.1', title: 'Drainage', inclusionStatus: 'included',
      owner: 'Construction Manager', acceptanceCriteria: ['Approved inspection records'],
      evidenceRefs: [{ kind: 'source', sourceId: 'scope', page: 2 }], status: 'reviewed',
    }],
    responsibilityAssignments: [{
      id: 'resp-drainage', scopeItemIds: ['drainage'], responsible: ['Construction Manager'],
      accountable: 'Project Manager', consulted: [], informed: [], interfaces: ['Traffic accommodation'], status: 'reviewed',
    }],
  };
}

describe('delivery_capability handler', () => {
  let root: string;
  let context: SessionToolContext;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'delivery-capability-'));
    context = {
      sessionId: 'delivery-session', workspacePath: root, sourcesPath: join(root, 'sources'),
      skillsPath: join(root, 'skills'), plansFolderPath: join(root, 'plans'), workingDirectory: root,
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} }, fs: createNodeFileSystem(), loadSourceConfig: () => null,
    };
    await handleDeliveryWorkspace(context, {
      action: 'init', projectId: 'n3-delivery', project: { id: 'n3-delivery', title: 'N3 Delivery', status: 'active' },
    });
    await handleDeliveryWorkspace(context, {
      action: 'upsert_sources', projectId: 'n3-delivery', sources: [
        { id: 'contract', name: 'Contract', path: 'C:/contract.pdf', kind: 'contract', status: 'active', sha256: 'a'.repeat(64) },
        { id: 'scope', name: 'Scope', path: 'C:/scope.pdf', kind: 'approved_scope', status: 'active', sha256: 'b'.repeat(64) },
      ],
    });
    await handleDeliveryWorkspace(context, {
      action: 'upsert_baselines', projectId: 'n3-delivery', baselines: [
        { id: 'contract-baseline', kind: 'contract', title: 'Contract', status: 'approved', evidenceRefs: [{ kind: 'source', sourceId: 'contract' }] },
        { id: 'scope-baseline', kind: 'scope', title: 'Scope', status: 'approved', evidenceRefs: [{ kind: 'source', sourceId: 'scope' }] },
      ],
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('persists a ready contract-scope pack and marks it stale after core change', async () => {
    const handlers = await import('./index.ts') as Record<string, unknown>;
    expect(typeof handlers.handleDeliveryCapability).toBe('function');
    const handle = handlers.handleDeliveryCapability as Function;
    const initialized = await handle(context, {
      action: 'init', projectId: 'n3-delivery', capability: 'contract_scope',
      enabled: true, required: true, data: contractScopeData(),
    });
    const output = JSON.parse(initialized.content[0]?.text ?? '{}');

    expect(initialized.isError).toBe(false);
    expect(output.audit.readiness).toBe('ready');
    expect(output.envelope.upstream).toEqual([{ capability: 'core', revision: 3 }]);
    expect(output.modelPath).toEndWith(join('packs', 'contract-scope.json'));

    await handleDeliveryWorkspace(context, {
      action: 'upsert_sources', projectId: 'n3-delivery', sources: [
        { id: 'progress', name: 'Progress Cut', path: 'C:/progress.xlsx', kind: 'progress', status: 'active', sha256: 'c'.repeat(64) },
      ],
    });
    const status = await handle(context, { action: 'status', projectId: 'n3-delivery', capability: 'contract_scope' });
    const statusOutput = JSON.parse(status.content[0]?.text ?? '{}');
    expect(statusOutput.stale).toBe(true);
    expect(statusOutput.effectiveReadiness).toBe('not_ready');
  });
});
