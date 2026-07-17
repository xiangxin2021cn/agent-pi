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

function documentAnalysisData(documentIds: string[] = ['tender-data']) {
  return {
    sections: documentIds.map((documentId) => ({
      id: `analysis-${documentId}`,
      documentId,
      title: `Analysis of ${documentId}`,
      kind: documentId === 'tender-data' ? 'tender_requirements' : 'other',
      summary: `Reviewed source content and registered the material facts from ${documentId}.`,
      sourceRefs: [{ documentId, page: 1 }],
      status: 'reviewed',
    })),
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

function boqPricingData() {
  const step = (narrative: string, documentId: string) => ({
    narrative,
    sourceRefs: [{ documentId, page: 1 }],
  });
  return {
    currency: 'ZAR',
    pricingStandard: 'c51_pure_direct_cost_v1',
    vatTreatment: 'exclusive',
    indirectCostPolicy: 'excluded_from_item_direct_cost',
    pricingStatus: 'reviewed',
    itemBuildUps: [
      {
        boqItemId: 'boq-5201',
        status: 'reviewed',
        steps: {
          scopeQuantity: step('Scope and quantity are reconciled to the registered BOQ row.', 'boq'),
          methodProductivity: step('Method and productivity are derived from the registered specification.', 'spec'),
          resourceConsumption: step('Resource consumption is calculated from the reviewed work method.', 'spec'),
          sourcedRatesDirectCost: step('Direct cost uses registered source evidence.', 'spec'),
          reconciliationRisk: step('The build-up is reconciled to the BOQ unit and scope.', 'spec'),
        },
        itemIdentity: {
          code: '52.01', description: 'Concrete side drain', unit: 'm', quantity: '1250.5',
          sourceRef: { documentId: 'boq', sheet: 'Drainage', cell: 'B18:F18' },
        },
        scopeBasis: {
          specificationRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
          measurementRuleRefs: [{ documentId: 'spec', page: 24, clause: '5.2.4' }],
          inclusions: ['Scheduled concrete side drain scope'],
          exclusions: ['General overhead and profit'],
          testingRequirements: ['Concrete acceptance and line/level inspection'],
          methodConstraints: ['Construct to DRAIN-01 and clause 5.2'],
        },
        productivityBasis: {
          methodSequence: ['Excavate', 'Prepare foundation', 'Place concrete', 'Finish and inspect'],
          crew: [{
            id: 'crew-drainage', kind: 'labour', description: 'Drainage crew', count: '8', assumptionStatus: 'sourced',
            sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
          }],
          workingHoursPerDay: '8', bottleneck: 'Concrete placement cycle', theoreticalProductionRate: '200',
          calculationFormula: '200 m/day theoretical x effective factor',
          scenarios: [
            { scenario: 'optimistic', productionRate: '120', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.6', basis: 'Continuous access', assumptionStatus: 'scenario', sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }] },
            { scenario: 'base', productionRate: '100', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.5', basis: 'Normal production', assumptionStatus: 'sourced', sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }] },
            { scenario: 'pessimistic', productionRate: '80', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.4', basis: 'Restricted access', assumptionStatus: 'scenario', sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }] },
          ],
        },
        resourceCoverage: [
          { kind: 'labour', applicability: 'included', basis: 'Direct drainage crew' },
          { kind: 'plant', applicability: 'not_applicable', basis: 'Plant covered by adjacent measured item' },
          { kind: 'material', applicability: 'not_applicable', basis: 'Concrete covered by separate supply item' },
          { kind: 'subcontract', applicability: 'not_applicable', basis: 'Self-performed' },
          { kind: 'transport', applicability: 'not_applicable', basis: 'Transport included in separate supply rate' },
          { kind: 'waste', applicability: 'not_applicable', basis: 'No material in this labour-only fixture' },
        ],
        resourceConsumptions: [
          {
            id: 'resource-crew', kind: 'labour', description: 'Drainage crew', quantity: '2', unit: 'h/m', assumptionStatus: 'sourced',
            quantityBasis: 'per_boq_unit', calculationBasis: 'Crew hours divided by 100 m/day output',
            costComponentId: 'cost-crew', sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
          },
        ],
        planningBasis: {
          methodId: 'concrete-side-drain',
          productionRate: '100',
          quantityUnit: 'm',
          timeUnit: 'working_day',
          duration: '12.505',
          calendarId: 'cal-1',
          activityId: 'excavate',
          assumptionStatus: 'sourced',
          sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
        },
        initialCashFlow: [{
          period: '2026-08',
          activityId: 'excavate',
          weight: '1',
          amount: '625250',
          basis: 'Initial allocation follows the priced work activity.',
          assumptionStatus: 'sourced',
          sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
        }],
        costComponents: [
          {
            id: 'cost-crew', kind: 'labour', description: 'Drainage crew', quantity: '2', unit: 'h/m',
            rate: '250', amount: '500', rateSourceRef: { documentId: 'spec', page: 1 },
            rateBasis: { sourceType: 'published_schedule', acquisitionMode: 'not_applicable', location: 'Durban', effectiveDate: '2026-07-17', vatTreatment: 'exclusive' },
            assumptionStatus: 'sourced',
          },
        ],
        directCost: '500',
        directCostSummary: {
          labour: '500', plant: '0', material: '0', subcontract: '0', transport: '0', waste: '0', other: '0',
          unitDirectCost: '500', boqQuantity: '1250.5', itemDirectCost: '625250',
        },
        riskScenarios: [{
          id: 'risk-drainage-productivity', variable: 'Daily drain output', optimistic: '120 m/day', base: '100 m/day',
          pessimistic: '80 m/day', trigger: 'Restricted workfront access', treatment: 'Open a second workfront',
          assumptionStatus: 'sourced', sourceRefs: [{ documentId: 'spec', page: 20, clause: '5.2' }],
        }],
        conditions: [],
        riskNotes: [],
      },
    ],
    resourceSummary: [
      { kind: 'labour', description: 'Drainage crew', quantity: '2501', unit: 'h' },
    ],
    assumptions: [],
  };
}

function bidderCommitmentsData() {
  const categories = [
    'labour', 'management', 'plant', 'materials', 'temporary_facilities',
    'method', 'productivity', 'sequence_timing', 'subcontracting',
  ];
  return {
    confirmation: {
      confirmed: true,
      confirmedBy: 'Bid Manager',
      confirmedAt: '2026-07-17T08:00:00.000Z',
      basisStatement: 'Confirmed bidder planning inputs for the tender methodology.',
    },
    commitments: categories.map((category) => ({
      id: `commitment-${category}`,
      category,
      subject: category,
      decision: `Confirmed ${category} basis.`,
      status: 'confirmed',
      appliesToAllBoqItems: true,
      affectedBoqItemIds: [],
      inputReference: 'User confirmation in bidder commitments stage',
      sourceRefs: [],
    })),
    openItems: [],
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

  test('rejects a capability write while the tender core is not ready', async () => {
    const handler = await loadHandler();
    await handleTenderWorkspace(context, {
      action: 'init',
      projectId: 'unready-tender',
      project: { id: 'unready-tender', title: 'Unready Tender', status: 'active' },
    });

    const result = await handler(context, {
      action: 'init',
      projectId: 'unready-tender',
      capability: 'document_analysis',
      data: { sections: [] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires ready tender core');
  });

  test('initializes and persists a ready evaluation strategy pack', async () => {
    const handler = await loadHandler();
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis', data: documentAnalysisData(),
    });
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
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis', data: documentAnalysisData(),
    });
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
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis', data: documentAnalysisData(),
    });
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
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'document_analysis',
      data: documentAnalysisData(['tender-data', 'boq', 'spec', 'drawing']),
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
    await handler(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      capability: 'document_analysis',
      data: documentAnalysisData(['tender-data', 'boq', 'spec', 'drawing']),
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
    expect(result.content[0]?.text).toContain('requires ready upstream capability document_analysis');
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
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis',
      data: documentAnalysisData(['tender-data', 'boq', 'spec', 'drawing']),
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
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'boq_five_step_pricing', data: boqPricingData(),
    });
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'bidder_commitments', data: bidderCommitmentsData(),
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
      { capability: 'document_analysis', revision: 1 },
      { capability: 'boq_reconciliation', revision: 1 },
      { capability: 'boq_five_step_pricing', revision: 1 },
      { capability: 'bidder_commitments', revision: 1 },
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
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis',
      data: documentAnalysisData(['tender-data', 'boq', 'spec', 'drawing']),
    });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'evaluation_strategy', data: strategyData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_reconciliation', data: boqData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_five_step_pricing', data: boqPricingData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'bidder_commitments', data: bidderCommitmentsData() });
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
      { capability: 'boq_five_step_pricing', revision: 1 },
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
    await handler(context, {
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis',
      data: documentAnalysisData(['tender-data', 'boq', 'spec', 'drawing', 'quote']),
    });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'evaluation_strategy', data: strategyData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_reconciliation', data: boqData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'boq_five_step_pricing', data: boqPricingData() });
    await handler(context, { action: 'init', projectId: 'n3-upgrade', capability: 'bidder_commitments', data: bidderCommitmentsData() });
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
      { capability: 'boq_five_step_pricing', revision: 1 },
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
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis', data: documentAnalysisData(),
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
      { capability: 'document_analysis', revision: 1 },
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
      action: 'init', projectId: 'n3-upgrade', capability: 'document_analysis', data: documentAnalysisData(),
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
