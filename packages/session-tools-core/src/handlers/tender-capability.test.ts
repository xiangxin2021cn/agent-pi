import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

function executionData() {
  return {
    workPackages: [
      {
        id: 'wp-drainage-01',
        title: 'Construct concrete side drains',
        boqItemIds: ['boq-5201'],
        requirementIds: ['req-drainage'],
        methodSteps: [
          'Confirm setting-out and service clearances.',
          'Excavate and prepare the founding surface.',
          'Place, finish, cure, and inspect the concrete drain.',
        ],
        resourceNeeds: [
          {
            resourceClass: 'excavator',
            quantity: '1',
            unit: 'item',
            basis: 'One active drainage workfront',
            status: 'verified',
          },
        ],
        holdPoints: ['Founding surface acceptance before concrete placement'],
        interfaces: ['Traffic accommodation and adjacent earthworks'],
        constraints: ['Maintain access through the live work zone'],
        temporaryWorks: [],
        hseControls: ['Approved excavation and plant-pedestrian controls'],
        environmentalControls: ['Prevent sediment discharge from excavation'],
        sourceRefs: [
          { documentId: 'spec', page: 20, clause: '5.2' },
          { documentId: 'drawing', page: 3, section: 'DRAIN-01' },
        ],
        status: 'reviewed',
      },
    ],
  };
}

function scheduleData() {
  return {
    programmeStart: '2026-08-03',
    programmeStatus: 'reviewed',
    calendars: [
      { id: 'cal-1', name: 'Tender calendar', workingDays: [1, 2, 3, 4, 5], exceptions: [] },
    ],
    activities: [
      scheduleActivity('setout', 'Set out drainage works', 1, []),
      scheduleActivity('excavate', 'Excavate drainage', 2, [{ activityId: 'setout', type: 'FS', lagDays: 0 }]),
      scheduleActivity('concrete', 'Construct concrete drain', 3, [{ activityId: 'excavate', type: 'FS', lagDays: 0 }]),
    ],
    resources: [
      { id: 'crew', class: 'drainage-crew', capacity: '1', unit: 'crew', calendarId: 'cal-1' },
    ],
    assignments: [
      { activityId: 'setout', resourceId: 'crew', demand: '1' },
      { activityId: 'excavate', resourceId: 'crew', demand: '1' },
      { activityId: 'concrete', resourceId: 'crew', demand: '1' },
    ],
    milestones: [],
  };
}

function scheduleActivity(id: string, name: string, durationDays: number, predecessors: unknown[]) {
  return {
    id,
    workPackageId: 'wp-drainage-01',
    name,
    durationDays,
    durationBasis: 'Derived from the reviewed tender work package.',
    calendarId: 'cal-1',
    predecessors,
    requirementIds: [],
    sourceRefs: [{ documentId: 'spec', page: 20 }],
    confidence: 'confirmed',
  };
}

function costData() {
  return {
    currency: 'ZAR',
    costStatus: 'reviewed',
    rateSources: [
      {
        id: 'rate-concrete',
        description: 'Synthetic supplier quote',
        sourceRef: { documentId: 'quote', page: 1 },
        currency: 'ZAR',
        effectiveAt: '2026-07-01',
      },
    ],
    components: [
      {
        id: 'component-concrete',
        kind: 'material',
        description: 'Concrete supply allowance',
        quantity: '1250.5',
        unit: 'm',
        rate: '10.25',
        rateSourceId: 'rate-concrete',
        assumptionStatus: 'sourced',
      },
    ],
    buildUps: [
      { boqItemId: 'boq-5201', componentIds: ['component-concrete'], total: '12817.625' },
    ],
    cashFlow: [
      {
        period: '2026-08',
        activityIds: ['concrete'],
        plannedCost: '12817.625',
        cumulativeCost: '12817.625',
      },
    ],
    scenarios: [],
  };
}

function submissionData(filePath: string, sha256: string) {
  return {
    submissionStatus: 'reviewed',
    items: [
      {
        deliverableId: 'methodology',
        filePath,
        format: 'pdf',
        signatureStatus: 'not_required',
        dependencies: [],
        validationStatus: 'passed',
        evidenceRefs: [{ documentId: 'tender-data', page: 12 }],
        sha256,
        checks: {
          filePresent: true,
          formatMatch: true,
          templateMatch: true,
          renderPassed: true,
          hashVerified: true,
        },
      },
    ],
    contradictions: [],
    redTeamFindings: [],
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

  test('rejects execution planning before required upstream packs are ready', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'execution_plan',
      data: executionData(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires ready upstream capability evaluation_strategy');
  });

  test('initializes a ready execution plan from ready evaluation and BOQ packs', async () => {
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
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      data: strategyData(),
    });
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'boq_reconciliation',
      data: boqData(),
    });

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'execution_plan',
      enabled: true,
      required: true,
      data: executionData(),
    });
    expect(result.isError).toBe(false);
    const output = resultJson(result);

    expect(output.audit.readiness).toBe('ready');
    expect(output.envelope.upstream).toEqual([
      { capability: 'core', revision: 6 },
      { capability: 'evaluation_strategy', revision: 1 },
      { capability: 'boq_reconciliation', revision: 1 },
    ]);
    expect(output.modelPath).toEndWith(join('packs', 'execution-plan.json'));
  });

  test('rejects schedule planning before the execution pack is ready', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'schedule_resources',
      data: scheduleData(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires ready upstream capability execution_plan');
  });

  test('initializes a ready schedule and resource pack from a ready execution plan', async () => {
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
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'evaluation_strategy', data: strategyData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_reconciliation', data: boqData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'execution_plan', data: executionData() });

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'schedule_resources',
      enabled: true,
      required: true,
      data: scheduleData(),
    });
    expect(result.isError).toBe(false);
    const output = resultJson(result);

    expect(output.audit.readiness).toBe('ready');
    expect(output.audit.summary.projectDurationDays).toBe(6);
    expect(output.envelope.upstream).toEqual([
      { capability: 'core', revision: 6 },
      { capability: 'execution_plan', revision: 1 },
    ]);
    expect(output.modelPath).toEndWith(join('packs', 'schedule-resources.json'));
  });

  test('rejects cost planning before BOQ and schedule packs are ready', async () => {
    const handler = await loadHandler();
    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'cost_cashflow',
      data: costData(),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires ready upstream capability boq_reconciliation');
  });

  test('initializes a ready cost and cash-flow pack from ready BOQ and schedule packs', async () => {
    const handler = await loadHandler();
    await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: 'n3-upgrade',
      documents: [
        { id: 'boq', name: 'BOQ', path: 'C:/tender/boq.xlsx', kind: 'boq', status: 'active' },
        { id: 'spec', name: 'Specification', path: 'C:/tender/spec.pdf', kind: 'specification', status: 'active' },
        { id: 'drawing', name: 'Drawing', path: 'C:/tender/drawing.pdf', kind: 'drawing', status: 'active' },
        { id: 'quote', name: 'Supplier Quote', path: 'C:/tender/quote.pdf', kind: 'supporting_evidence', status: 'active' },
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
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'evaluation_strategy', data: strategyData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_reconciliation', data: boqData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'execution_plan', data: executionData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'schedule_resources', data: scheduleData() });

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'cost_cashflow',
      enabled: true,
      required: true,
      data: costData(),
    });
    expect(result.isError).toBe(false);
    const output = resultJson(result);

    expect(output.audit.readiness).toBe('ready');
    expect(output.audit.summary.estimatedTotal).toBe('12817.625');
    expect(output.envelope.upstream).toEqual([
      { capability: 'core', revision: 6 },
      { capability: 'boq_reconciliation', revision: 1 },
      { capability: 'schedule_resources', revision: 1 },
    ]);
    expect(output.modelPath).toEndWith(join('packs', 'cost-cashflow.json'));
  });

  test('initializes a ready submission audit from the ready required packs', async () => {
    const handler = await loadHandler();
    await handleTenderWorkspace(context, {
      action: 'upsert_deliverables',
      projectId: 'n3-upgrade',
      deliverables: [
        {
          id: 'methodology',
          title: 'Technical methodology',
          format: 'pdf',
          requirementIds: ['req-method'],
          status: 'ready',
        },
      ],
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_responses',
      projectId: 'n3-upgrade',
      responses: [
        {
          id: 'response-method',
          title: 'Methodology response',
          requirementIds: ['req-method'],
          criterionIds: ['criterion-method'],
          deliverableId: 'methodology',
          evidenceRefs: [{ documentId: 'tender-data', page: 12 }],
          status: 'verified',
        },
      ],
    });
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'evaluation_strategy',
      enabled: true,
      required: true,
      data: strategyData(),
    });
    const artifactPath = join(workingDirectory, 'Agent Pi Outputs', 'methodology.pdf');
    mkdirSync(join(workingDirectory, 'Agent Pi Outputs'), { recursive: true });
    const artifact = Buffer.from('synthetic rendered tender methodology');
    writeFileSync(artifactPath, artifact);
    const artifactHash = createHash('sha256').update(artifact).digest('hex');

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'submission_audit',
      enabled: true,
      required: true,
      data: submissionData(artifactPath, artifactHash),
    });

    expect(result.isError).toBe(false);
    const output = resultJson(result);
    expect(output.audit.readiness).toBe('ready');
    expect(output.audit.summary.passedSubmissionItems).toBe(1);
    expect(output.envelope.upstream).toEqual([
      { capability: 'core', revision: 6 },
      { capability: 'evaluation_strategy', revision: 1 },
    ]);
    expect(output.modelPath).toEndWith(join('packs', 'submission-audit.json'));
    expect(readdirSync(join(workingDirectory, '.agent-pi', 'business'))).toEqual(['tender']);
  });

  test('overrides self-reported file and hash checks with runtime verification', async () => {
    const handler = await loadHandler();
    await handleTenderWorkspace(context, {
      action: 'upsert_deliverables',
      projectId: 'n3-upgrade',
      deliverables: [{ id: 'methodology', title: 'Technical methodology', format: 'pdf', requirementIds: ['req-method'], status: 'ready' }],
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_responses',
      projectId: 'n3-upgrade',
      responses: [{
        id: 'response-method', title: 'Methodology response', requirementIds: ['req-method'],
        criterionIds: ['criterion-method'], deliverableId: 'methodology',
        evidenceRefs: [{ documentId: 'tender-data', page: 12 }], status: 'verified',
      }],
    });
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'evaluation_strategy',
      enabled: true, required: true, data: strategyData(),
    });

    const result = await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'submission_audit',
      data: submissionData(join(workingDirectory, 'Agent Pi Outputs', 'missing.pdf'), 'a'.repeat(64)),
    });
    const output = resultJson(result);

    expect(result.isError).toBe(false);
    expect(output.audit.readiness).toBe('not_ready');
    expect(output.audit.issues.map((issue: { code: string }) => issue.code)).toContain('submission_file_missing');
    expect(output.audit.issues.map((issue: { code: string }) => issue.code)).toContain('submission_hash_failed');
  });
});
