import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RpcServer } from '../../transport/types.ts';
import { registerDeliveryWorkspaceHandlers } from './delivery-workspace.ts';

function harness() {
  const handlers = new Map<string, HandlerFn>();
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); },
    push() {},
    async invokeClient() { return undefined; },
    hasClientCapability() { return false; },
    findClientsWithCapability() { return []; },
  };
  registerDeliveryWorkspaceHandlers(server);
  return handlers;
}

const requestContext = { clientId: 'test', workspaceId: 'workspace-test', webContentsId: 1 };

describe('delivery workspace RPC', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('lists and loads typed delivery workspace snapshots independently from tender', async () => {
    root = mkdtempSync(join(tmpdir(), 'delivery-workspace-rpc-'));
    const projectDir = join(root, '.agent-pi', 'business', 'delivery', 'n3-delivery');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'delivery-workspace.json'), JSON.stringify({
      schemaVersion: 1, revision: 1,
      project: { id: 'n3-delivery', title: 'N3 Delivery', status: 'active' },
      sources: [], snapshots: [], baselines: [], knowledgeUses: [],
    }));

    const handlers = harness();
    const channels = (RPC_CHANNELS as any).deliveryWorkspace;
    const list = await handlers.get(channels.LIST)!(requestContext, { workingDirectory: root }) as any[];
    const bundle = await handlers.get(channels.GET)!(requestContext, { workingDirectory: root, projectId: 'n3-delivery' }) as any;

    expect(list).toEqual([expect.objectContaining({ projectId: 'n3-delivery', title: 'N3 Delivery', revision: 1 })]);
    expect(bundle.workspace.project.id).toBe('n3-delivery');
    expect(bundle.audit.readiness).toBe('not_ready');
    expect(bundle.capabilityIndex.capabilities).toEqual([]);
    expect(bundle.packs).toEqual({});
  });

  test('routes typed mutations through delivery tools without creating tender storage', async () => {
    root = mkdtempSync(join(tmpdir(), 'delivery-workspace-rpc-'));
    const handlers = harness();
    const channels = (RPC_CHANNELS as any).deliveryWorkspace;
    const mutate = handlers.get(channels.MUTATE)!;
    const result = await mutate(requestContext, {
      workingDirectory: root,
      target: 'workspace',
      args: { action: 'init', projectId: 'n3-delivery', project: { id: 'n3-delivery', title: 'N3 Delivery', status: 'active' } },
    }) as any;

    expect(result.workspace.project.id).toBe('n3-delivery');
    expect(result.modelPath).toContain('delivery-workspace.json');
    expect(result.modelPath).not.toContain(`${join('business', 'tender')}`);
  });
});
