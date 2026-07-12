import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';

describe('delivery_workspace handler', () => {
  let root: string;
  let context: SessionToolContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'delivery-workspace-'));
    context = {
      sessionId: 'delivery-session', workspacePath: root, sourcesPath: join(root, 'sources'),
      skillsPath: join(root, 'skills'), plansFolderPath: join(root, 'plans'), workingDirectory: root,
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
      fs: createNodeFileSystem(), loadSourceConfig: () => null,
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('initializes from direct inputs without creating tender or investment stores', async () => {
    const handlers = await import('./index.ts') as Record<string, unknown>;
    expect(typeof handlers.handleDeliveryWorkspace).toBe('function');
    const handle = handlers.handleDeliveryWorkspace as Function;

    await handle(context, {
      action: 'init', projectId: 'n3-delivery',
      project: { id: 'n3-delivery', title: 'N3 Delivery', status: 'active', dataDate: '2026-07-12' },
    });
    await handle(context, {
      action: 'upsert_sources', projectId: 'n3-delivery',
      sources: [{
        id: 'contract', name: 'Approved Contract', path: 'C:/project/contract.pdf', kind: 'contract',
        status: 'active', sha256: 'a'.repeat(64),
      }],
    });
    const result = await handle(context, {
      action: 'upsert_baselines', projectId: 'n3-delivery',
      baselines: [{
        id: 'contract-baseline', kind: 'contract', title: 'Approved contract', status: 'approved',
        evidenceRefs: [{ kind: 'source', sourceId: 'contract', page: 1 }],
      }],
    });
    const output = JSON.parse(result.content[0]?.text ?? '{}');

    expect(result.isError).toBe(false);
    expect(output.audit.readiness).toBe('ready');
    expect(output.modelPath).toContain(join('business', 'delivery', 'n3-delivery'));
    expect(readdirSync(join(root, '.agent-pi', 'business'))).toEqual(['delivery']);
  });
});
