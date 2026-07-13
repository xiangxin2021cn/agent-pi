import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { publishBusinessKnowledgeArtifact, toBusinessEvidenceSnapshot } from '../knowledge-base-business-publication.ts';

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
      knowledgeBaseRegistryRootPath: join(root, 'config'),
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

  test('imports only snapshots registered in the enterprise knowledge base', async () => {
    const { handleInvestmentWorkspace } = await import('./investment-workspace.ts');
    await handleInvestmentWorkspace(context, {
      action: 'init', projectId: 'quarry-investment',
      project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' },
    });
    const artifactPath = join(root, 'approved-delivery.json');
    writeFileSync(artifactPath, '{"cost":"approved"}\n', 'utf8');
    const publication = publishBusinessKnowledgeArtifact(context.knowledgeBaseRegistryRootPath!, artifactPath, {
      publicationId: 'quarry-approved-delivery', producerPlugin: 'delivery', producerWorkspaceId: 'quarry-delivery',
      producerRevision: 5, title: 'Approved delivery cost', category: 'Projects/Quarry',
      approvalState: 'approved', userConfirmed: true, publishedAt: '2026-07-12T10:00:00.000Z',
    });
    const snapshot = toBusinessEvidenceSnapshot(publication, 'delivery-snapshot', '2026-07-12T11:00:00.000Z');

    const accepted = await handleInvestmentWorkspace(context, {
      action: 'upsert_snapshots', projectId: 'quarry-investment', snapshots: [snapshot],
    });
    expect(accepted.isError).toBe(false);

    const rejected = await handleInvestmentWorkspace(context, {
      action: 'upsert_snapshots', projectId: 'quarry-investment',
      snapshots: [{ ...snapshot, id: 'fabricated', managedArtifactPath: join(root, 'not-registered.json') }],
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toContain('registered approved publication');

    const status = await handleInvestmentWorkspace(context, { action: 'status', projectId: 'quarry-investment' });
    const output = JSON.parse(status.content[0]?.text ?? '{}');
    expect(output.workspace.revision).toBe(2);
    expect(output.workspace.snapshots).toEqual([snapshot]);
  });
});
