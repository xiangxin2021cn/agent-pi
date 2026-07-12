import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';
import { handleInvestmentWorkspace } from './investment-workspace.ts';

function capabilityData(categories: string[]) {
  const evidenceRefs = [{ kind: 'source', sourceId: 'mandate', page: 1 }];
  return {
    reviewStatus: 'reviewed',
    findings: categories.map((category) => ({ id: category, category, title: category, conclusion: 'Verified', evidenceRefs, status: 'verified', confidence: 'confirmed' })),
    assumptions: [{ id: 'base', name: 'Base', value: '1.0', evidenceRefs, status: 'approved' }],
    metrics: [{ id: 'screening-score', name: 'Screening score', value: '10.25', unit: 'points', evidenceRefs, status: 'verified' }],
    risks: [], scenarios: [], approvals: [],
  };
}

describe('investment_capability handler', () => {
  let root: string;
  let context: SessionToolContext;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'investment-capability-'));
    context = {
      sessionId: 'investment-session', workspacePath: root, sourcesPath: join(root, 'sources'),
      skillsPath: join(root, 'skills'), plansFolderPath: join(root, 'plans'), workingDirectory: root,
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} }, fs: createNodeFileSystem(), loadSourceConfig: () => null,
    };
    await handleInvestmentWorkspace(context, {
      action: 'init', projectId: 'quarry-investment',
      project: { id: 'quarry-investment', title: 'Quarry Investment', stage: 'screening', status: 'active', baseCurrency: 'USD', valuationDate: '2026-07-12' },
    });
    await handleInvestmentWorkspace(context, {
      action: 'upsert_sources', projectId: 'quarry-investment',
      sources: [{ id: 'mandate', name: 'Investment Mandate', path: 'C:/mandate.pdf', kind: 'mandate', status: 'active', sha256: 'a'.repeat(64) }],
    });
    await handleInvestmentWorkspace(context, {
      action: 'upsert_assumption_sets', projectId: 'quarry-investment',
      assumptionSets: [{ id: 'base', title: 'Base', status: 'approved', evidenceRefs: [{ kind: 'source', sourceId: 'mandate' }] }],
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('persists a ready screening pack only under the investment plugin root', async () => {
    const handlers = await import('./index.ts') as Record<string, unknown>;
    expect(typeof handlers.handleInvestmentCapability).toBe('function');
    const result = await (handlers.handleInvestmentCapability as Function)(context, {
      action: 'init', projectId: 'quarry-investment', capability: 'mandate_screening',
      enabled: true, required: true, data: capabilityData(['mandate', 'opportunity', 'stage_gate']),
    });
    const output = JSON.parse(result.content[0]?.text ?? '{}');
    expect(result.isError).toBe(false);
    expect(output.audit.readiness).toBe('ready');
    expect(output.envelope.upstream).toEqual([{ capability: 'core', revision: 3 }]);
    expect(output.modelPath).toEndWith(join('business', 'investment', 'quarry-investment', 'packs', 'mandate-screening.json'));
    expect(readdirSync(join(root, '.agent-pi', 'business'))).toEqual(['investment']);
  });

  test('blocks valuation until its independent investment upstream packs are ready', async () => {
    const handlers = await import('./index.ts') as Record<string, unknown>;
    const result = await (handlers.handleInvestmentCapability as Function)(context, {
      action: 'init', projectId: 'quarry-investment', capability: 'financial_valuation',
      data: { ...capabilityData(['capex', 'opex', 'revenue', 'valuation']), scenarios: [{ id: 'base', name: 'Base', status: 'reviewed', assumptionIds: ['base'], metricIds: ['screening-score'] }] },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires ready upstream capability resource_technical');
    expect(result.content[0]?.text).not.toMatch(/tender|delivery/i);
  });
});
