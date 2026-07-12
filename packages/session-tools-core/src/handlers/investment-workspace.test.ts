import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';

describe('investment_workspace handler', () => {
  let root: string;
  let context: SessionToolContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'investment-workspace-'));
    context = {
      sessionId: 'investment-session', workspacePath: root, sourcesPath: join(root, 'sources'),
      skillsPath: join(root, 'skills'), plansFolderPath: join(root, 'plans'), workingDirectory: root,
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
      fs: createNodeFileSystem(), loadSourceConfig: () => null,
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('persists only under the independent investment root', async () => {
    const handlers = await import('./index.ts') as Record<string, unknown>;
    expect(typeof handlers.handleInvestmentWorkspace).toBe('function');
    const handle = handlers.handleInvestmentWorkspace as Function;
    await handle(context, {
      action: 'init', projectId: 'quarry-investment',
      project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' },
    });
    await handle(context, {
      action: 'upsert_sources', projectId: 'quarry-investment',
      sources: [{ id: 'mandate', name: 'Investment Mandate', path: 'C:/mandate.pdf', kind: 'mandate', status: 'active', sha256: 'a'.repeat(64) }],
    });
    const result = await handle(context, {
      action: 'upsert_assumption_sets', projectId: 'quarry-investment',
      assumptionSets: [{ id: 'screening', title: 'Screening Assumptions', status: 'approved', evidenceRefs: [{ kind: 'source', sourceId: 'mandate' }] }],
    });
    const output = JSON.parse(result.content[0]?.text ?? '{}');
    expect(result.isError).toBe(false);
    expect(output.audit.readiness).toBe('ready');
    expect(output.modelPath).toContain(join('business', 'investment', 'quarry-investment'));
    expect(readdirSync(join(root, '.agent-pi', 'business'))).toEqual(['investment']);
  });
});
