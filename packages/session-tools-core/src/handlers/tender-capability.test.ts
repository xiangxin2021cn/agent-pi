import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { createNodeFileSystem } from '../context.ts';
import { handleTenderWorkspace } from './tender-workspace.ts';

type TenderCapabilityHandler = (
  context: SessionToolContext,
  args: Record<string, unknown>,
) => Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;

function resultJson(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

async function loadHandler(): Promise<TenderCapabilityHandler> {
  const handlers = await import('./index.ts') as Record<string, unknown>;
  expect(typeof handlers.handleTenderCapability).toBe('function');
  return handlers.handleTenderCapability as TenderCapabilityHandler;
}

function strategyData() {
  return {
    strategies: [
      {
        criterionId: 'criterion-method',
        priority: 'high',
        targetScore: 17,
        responseOwner: 'Technical Manager',
        responseTheme: 'A buildable methodology with verified controls.',
        evidencePlan: ['Cite the tender requirement and approved evidence.'],
        evidenceRefs: [{ documentId: 'tender-data', page: 12 }],
        evidenceArtifactPaths: [],
        differentiators: ['Comparable project evidence'],
        risks: [],
        status: 'reviewed',
      },
    ],
  };
}

function boqData() {
  return {
    items: [
      {
        id: 'boq-5201',
        source: { documentId: 'boq', sheet: 'Drainage', cell: 'B18:F18' },
        code: '52.01',
        description: 'Concrete side drain',
        unit: 'm',
        quantity: '1250.5',
        quantityBasis: 'boq',
        quantityStatus: 'sourced',
        quantityRefs: [{ documentId: 'boq', sheet: 'Drainage', cell: 'F18' }],
      },
    ],
    scopeLinks: [
      {
        boqItemId: 'boq-5201',
        requirementIds: ['req-drainage'],
        specificationRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
        drawingRefs: [{ documentId: 'drawing', page: 3, section: 'DRAIN-01' }],
        measurementRuleRefs: [{ documentId: 'spec', page: 24, clause: '5.2.4' }],
        inclusions: ['Scheduled concrete side drain scope'],
        exclusions: [],
        assumptions: [],
        gapStatus: 'clear',
      },
    ],
  };
}

describe('tender_capability handler', () => {
  let root: string;
  let workingDirectory: string;
  let context: SessionToolContext;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-capability-'));
    workingDirectory = join(root, 'project');
    context = {
      sessionId: 'session-1',
      workspacePath: join(root, 'workspace'),
      sourcesPath: join(root, 'workspace', 'sources'),
      skillsPath: join(root, 'workspace', 'skills'),
      plansFolderPath: join(root, 'workspace', 'plans'),
      workingDirectory,
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: createNodeFileSystem(),
      loadSourceConfig: () => null,
    };

    await handleTenderWorkspace(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      project: { id: 'n3-upgrade', title: 'N3 Upgrade', status: 'active' },
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: 'n3-upgrade',
      documents: [
        {
          id: 'tender-data',
          name: 'Tender Data',
          path: 'C:/tender/data.pdf',
          kind: 'tender_data',
          status: 'active',
        },
      ],
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_requirements',
      projectId: 'n3-upgrade',
      requirements: [
        {
          id: 'req-method',
          title: 'Technical methodology',
          text: 'Submit the project methodology.',
          type: 'evaluated',
          criticality: 'high',
          source: { documentId: 'tender-data', page: 12 },
          evidenceNeeded: ['Relevant project record'],
          status: 'planned',
        },
      ],
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_criteria',
      projectId: 'n3-upgrade',
      criteria: [
        {
          id: 'criterion-method',
          title: 'Methodology quality',
          method: 'weighted',
          weight: 20,
          requirementIds: ['req-method'],
          source: { documentId: 'tender-data', page: 12 },
          evidenceNeeded: ['Method statement'],
          status: 'planned',
        },
      ],
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('initializes and persists a ready evaluation strategy pack', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      enabled: true,
      required: true,
      data: strategyData(),
    });

    expect(result.isError).toBe(false);
    const output = resultJson(result);
    expect(output.envelope.revision).toBe(1);
    expect(output.audit.readiness).toBe('ready');
    expect(output.effectiveReadiness).toBe('ready');
    expect(output.stale).toBe(false);
    expect(output.indexEntry.required).toBe(true);
    expect(existsSync(output.modelPath)).toBe(true);
    expect(existsSync(output.auditPath)).toBe(true);
    expect(existsSync(output.indexPath)).toBe(true);

    const projectDirectory = join(workingDirectory, '.agent-pi', 'business', 'tender', 'n3-upgrade');
    expect(readdirSync(join(projectDirectory, 'packs')).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  test('rejects an optimistic revision conflict without mutating the pack', async () => {
    const handler = await loadHandler();
    const initialized = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      data: strategyData(),
    });
    const modelPath = resultJson(initialized).modelPath;

    const result = await handler(context, {
      action: 'replace',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      expectedRevision: 99,
      data: strategyData(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('revision conflict');
    expect(JSON.parse(readFileSync(modelPath, 'utf8')).revision).toBe(1);
  });

  test('marks a pack stale after the tender core revision changes', async () => {
    const handler = await loadHandler();
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      data: strategyData(),
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: 'n3-upgrade',
      documents: [
        {
          id: 'supporting-record',
          name: 'Supporting Record',
          path: 'C:/tender/support.pdf',
          kind: 'supporting_evidence',
          status: 'active',
        },
      ],
    });

    const result = await handler(context, {
      action: 'status',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
    });
    const output = resultJson(result);

    expect(output.stale).toBe(true);
    expect(output.effectiveReadiness).toBe('not_ready');
    expect(output.indexEntry.stale).toBe(true);
    const persistedIndex = JSON.parse(readFileSync(output.indexPath, 'utf8'));
    expect(persistedIndex.coreRevision).toBe(5);
    expect(output.envelope.coreRevision).toBe(4);
  });

  test('rejects required when the capability is disabled', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'configure',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      enabled: false,
      required: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('required capability must be enabled');
  });

  test('initializes a ready BOQ reconciliation pack from registered sources', async () => {
    const handler = await loadHandler();
    await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: 'n3-upgrade',
      documents: [
        { id: 'boq', name: 'BOQ', path: 'C:/tender/boq.xlsx', kind: 'boq', status: 'active' },
        { id: 'spec', name: 'Specification', path: 'C:/tender/spec.pdf', kind: 'specification', status: 'active' },
        { id: 'drawing', name: 'Drawing', path: 'C:/tender/drawing.pdf', kind: 'drawing', status: 'active' },
      ],
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_requirements',
      projectId: 'n3-upgrade',
      requirements: [
        {
          id: 'req-drainage',
          title: 'Drainage scope',
          text: 'Construct the scheduled drainage works.',
          type: 'technical',
          criticality: 'high',
          source: { documentId: 'spec', page: 20, clause: '5.2' },
          evidenceNeeded: [],
          status: 'planned',
        },
      ],
    });

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'boq_reconciliation',
      enabled: true,
      required: true,
      data: boqData(),
    });
    expect(result.isError).toBe(false);
    const output = resultJson(result);
    expect(output.envelope.capability).toBe('boq_reconciliation');
    expect(output.audit.readiness).toBe('ready');
    expect(output.effectiveReadiness).toBe('ready');
    expect(output.modelPath).toEndWith(join('packs', 'boq-reconciliation.json'));
  });

  test('rejects capability packs that are not implemented yet', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'execution_plan',
      data: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not implemented');
  });
});
