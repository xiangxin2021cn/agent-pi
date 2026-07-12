import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RpcServer } from '../../transport/types.ts';
import { registerTenderWorkspaceHandlers } from './tender-workspace.ts';

function harness() {
  const handlers = new Map<string, HandlerFn>();
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); },
    push() {},
    async invokeClient() { return undefined; },
    hasClientCapability() { return false; },
    findClientsWithCapability() { return []; },
  };
  registerTenderWorkspaceHandlers(server);
  return handlers;
}

const requestContext = { clientId: 'test', workspaceId: 'workspace-test', webContentsId: 1 };

describe('tender workspace RPC', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('lists and loads typed tender workspace snapshots', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-workspace-rpc-'));
    const projectDir = join(root, '.agent-pi', 'business', 'tender', 'n3-upgrade');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'tender-workspace.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      project: { id: 'n3-upgrade', title: 'N3 Upgrade', status: 'active' },
      documents: [], requirements: [], criteria: [], deliverables: [], responses: [],
    }));

    const handlers = harness();
    const list = await handlers.get(RPC_CHANNELS.tenderWorkspace.LIST)!(requestContext, { workingDirectory: root }) as any[];
    const bundle = await handlers.get(RPC_CHANNELS.tenderWorkspace.GET)!(requestContext, { workingDirectory: root, projectId: 'n3-upgrade' }) as any;

    expect(list).toEqual([expect.objectContaining({ projectId: 'n3-upgrade', title: 'N3 Upgrade', revision: 1 })]);
    expect(bundle.workspace.project.id).toBe('n3-upgrade');
    expect(bundle.audit.readiness).toBe('not_ready');
    expect(bundle.capabilityIndex.capabilities).toEqual([]);
    expect(bundle.packs).toEqual({});
  });

  test('routes typed mutations through existing tender tools', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-workspace-rpc-'));
    const handlers = harness();
    const mutate = handlers.get(RPC_CHANNELS.tenderWorkspace.MUTATE)!;

    const result = await mutate(requestContext, {
      workingDirectory: root,
      target: 'workspace',
      args: {
        action: 'init',
        projectId: 'n3-upgrade',
        project: { id: 'n3-upgrade', title: 'N3 Upgrade', status: 'active' },
      },
    }) as any;

    expect(result.workspace.project.id).toBe('n3-upgrade');
    expect(result.modelPath).toContain('tender-workspace.json');
  });
});
