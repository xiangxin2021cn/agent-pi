import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RpcServer } from '../../transport/types.ts';
import { registerInvestmentWorkspaceHandlers } from './investment-workspace.ts';

function harness() {
  const handlers = new Map<string, HandlerFn>();
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); }, push() {},
    async invokeClient() { return undefined; }, hasClientCapability() { return false; }, findClientsWithCapability() { return []; },
  };
  registerInvestmentWorkspaceHandlers(server);
  return handlers;
}

const requestContext = { clientId: 'test', workspaceId: 'workspace-test', webContentsId: 1 };

describe('investment workspace RPC', () => {
  let root = '';
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('lists and loads investment workspaces independently', async () => {
    root = mkdtempSync(join(tmpdir(), 'investment-workspace-rpc-'));
    const projectDir = join(root, '.agent-pi', 'business', 'investment', 'quarry-investment');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'investment-workspace.json'), JSON.stringify({
      schemaVersion: 1, revision: 1,
      project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' },
      sources: [], snapshots: [], assumptionSets: [], knowledgeUses: [],
    }));
    const handlers = harness();
    const channels = (RPC_CHANNELS as any).investmentWorkspace;
    const list = await handlers.get(channels.LIST)!(requestContext, { workingDirectory: root }) as any[];
    const bundle = await handlers.get(channels.GET)!(requestContext, { workingDirectory: root, projectId: 'quarry-investment' }) as any;
    expect(list).toEqual([expect.objectContaining({ projectId: 'quarry-investment', title: 'Quarry Investment', stage: 'screening' })]);
    expect(bundle.workspace.project.id).toBe('quarry-investment');
    expect(bundle.capabilityIndex.capabilities).toEqual([]);
    expect(bundle.packs).toEqual({});
  });

  test('routes investment mutations without creating tender or delivery storage', async () => {
    root = mkdtempSync(join(tmpdir(), 'investment-workspace-rpc-'));
    const handlers = harness();
    const channels = (RPC_CHANNELS as any).investmentWorkspace;
    const result = await handlers.get(channels.MUTATE)!(requestContext, {
      workingDirectory: root, target: 'workspace',
      args: { action: 'init', projectId: 'quarry-investment', project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' } },
    }) as any;
    expect(result.workspace.project.id).toBe('quarry-investment');
    expect(result.modelPath).toContain(join('business', 'investment'));
    expect(result.modelPath).not.toMatch(/business[\\/]tender|business[\\/]delivery/);
  });
});
