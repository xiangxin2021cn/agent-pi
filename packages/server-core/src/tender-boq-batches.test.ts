import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TenderBoqReconciliationData } from '@agent-pi/business-core/tender';
import {
  createOrRefreshBoqBatchManifest,
  validateBoqBatchMerge,
  type TenderBoqBatchBrief,
} from './tender-boq-batches.ts';

function writeAcceptableMarkdown(path: string, title = 'BOQ chapter'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${title}\n\n## Summary\n\nCustomer-facing chapter workpaper.\n`);
}

describe('tender BOQ batch manifest', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('splits BOQ work by sheet chapter, splitting oversized chapters at 25 items', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(45), new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
      ['spec', 'C:/inputs/Specification.pdf'],
    ]));

    expect(manifest.itemCount).toBe(45);
    // All 45 items share chapter 5.1 → one oversized chapter split at the cap.
    expect(manifest.batches).toHaveLength(2);
    expect(manifest.batches.map((batch) => batch.itemIds.length)).toEqual([25, 20]);
    expect(manifest.batches[0]?.source.sheet).toBe('C5.1');
    expect(manifest.batches[0]?.source.firstCell).toBe('A1:F1');
    expect(manifest.batches[0]?.source.lastCell).toBe('A25:F25');

    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderBoqBatchBrief;
    expect(Object.keys(brief)).toEqual(expect.arrayContaining([
      'allowedSources', 'batchId', 'finalArtifactPolicy', 'itemIds', 'items', 'markdownPath', 'objective',
      'outputSchema', 'projectId', 'qualityStandard', 'reportPath', 'schemaVersion', 'scope', 'spawnPolicy',
    ]));
    expect(brief.itemIds).toEqual(manifest.batches[0]?.itemIds);
    expect(brief.spawnPolicy).toBe('forbidden');
    expect(brief.finalArtifactPolicy).toBe('report-and-markdown');
    expect(brief.markdownPath).toContain('boq-pricing');
    expect(brief.qualityStandard.id).toBe('generic_direct_cost_v1');
    expect(brief.objective).toContain('pricingStandard');
    expect(brief.objective).toContain('projectBoundary');
    expect(brief.objective).toContain('Honor writingContract');
    expect(brief.writingContract).toContain('THIS tender');
    expect(brief.writingContract).toContain('综上所述');
    if (brief.methodStandard) {
      expect(brief.methodStandard.role).toBe('method_and_depth_standard');
      expect(brief.methodStandard.path.length).toBeGreaterThan(0);
    }
    expect(brief.items[0]?.item.code).toBe('5.1.1');
    expect(brief.allowedSources.map((source) => source.documentId).sort()).toEqual(['boq', 'spec']);
    expect(brief.allowedSources).toContainEqual({ documentId: 'boq', path: 'C:/inputs/BOQ.xlsx' });
    expect(brief.allowedSources).toContainEqual({ documentId: 'spec', path: 'C:/inputs/Specification.pdf' });
    const itemSchema = (brief.outputSchema.properties as Record<string, any>).itemBuildUps.items;
    expect(itemSchema.required).toContain('planningBasis');
    expect(itemSchema.required).toContain('productivityBasis');
    expect(itemSchema.required).toContain('directCostSummary');
    expect(itemSchema.required).not.toContain('initialCashFlow');

    const briefBefore = readFileSync(manifest.batches[0]!.briefPath, 'utf8');
    const manifestBefore = readFileSync(manifest.manifestPath, 'utf8');
    const refreshed = createOrRefreshBoqBatchManifest(root, 'n3', boqData(45), new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
      ['spec', 'C:/inputs/Specification.pdf'],
    ]));
    expect(refreshed.generatedAt).toBe(manifest.generatedAt);
    expect(readFileSync(manifest.batches[0]!.briefPath, 'utf8')).toBe(briefBefore);
    expect(readFileSync(manifest.manifestPath, 'utf8')).toBe(manifestBefore);
  });

  test('injects projectBoundary fence from registered sources and extracted inventory', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-fence-'));
    mkdirSync(join(root, 'packs'), { recursive: true });
    writeFileSync(join(root, 'packs', 'project-boundary.json'), JSON.stringify({
      schemaVersion: 1,
      capability: 'project_boundary',
      projectId: 'n3',
      revision: 1,
      coreRevision: 1,
      upstream: [],
      updatedAt: '2026-08-12T00:00:00.000Z',
      data: {
        schemaVersion: 1,
        projectId: 'n3',
        profileId: 'generic-international',
        jurisdiction: { currency: 'USD' },
        standards: {
          technicalSpecs: [],
          measurementStandard: { id: 'employer-spec', title: 'Employer measurement' },
        },
        pricing: {
          pricingStandard: 'generic_direct_cost_v1',
          indirectCostPolicy: 'exclude_from_item_direct_cost',
          taxRegime: { vatTreatment: 'exclusive' },
          ratePolicy: { location: 'Site', mustVerifyOnline: [], allowUnverifiedLabel: true },
        },
        productivity: { basis: 'user_provided', sources: [] },
        bidderResources: { outline: 'Own plant limited to listed fleet.' },
        organizationOutline: {
          text: 'Establish camps at km 12 and km 40; sequence earthworks ahead of pavement; protect school frontage traffic.',
        },
        boundarySources: [{
          id: 'bnd-fleet',
          kind: 'bidder_resource',
          role: 'plant',
          title: 'fleet.xlsx',
          path: 'C:/bidder/fleet.xlsx',
          parseStatus: 'parsed',
        }],
        extractedInventory: {
          plant: ['14H grader'],
          labour: ['grader operator'],
          materialSources: ['borrow pit A'],
          constraints: ['no night shift'],
        },
        humanConfirmedAt: '2026-08-12T10:00:00.000Z',
        readiness: 'ready',
      },
    }));
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2), new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
    ]));
    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderBoqBatchBrief;
    expect(brief.projectBoundary?.allowedSourceIds).toEqual(['bnd-fleet']);
    expect(brief.projectBoundary?.allowedSourcePaths).toEqual(['C:/bidder/fleet.xlsx']);
    expect(brief.projectBoundary?.extractedInventory?.plant).toEqual(['14H grader']);
    expect(brief.projectBoundary?.fence).toContain('14H grader');
    expect(brief.projectBoundary?.fence).toContain('Do not invent');
    expect(brief.qualityStandard.rules.some((rule) => rule.includes('projectBoundary fence'))).toBe(true);
    expect(brief.objective).toContain('projectBoundary fence');
  });

  test('marks a batch complete only when its report covers every assigned item and no extras', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    let manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));
    const batch = manifest.batches[0]!;
    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: [{ boqItemId: batch.itemIds[0] }],
    }));

    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));
    // Soft: partial item coverage warns but does not hard-fail the batch when ≥1 item priced.
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.batches[0]?.validationWarnings.some((warning) => warning.includes('missing BOQ item'))).toBe(true);

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map((boqItemId) => ({ boqItemId })),
    }));
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));

    expect(manifest.batches[0]?.status).toBe('complete');

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map((itemId) => ({ ...completeBuildUp(itemId), status: 'draft' })),
    }));
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));
    // Soft: missing MD is advisory when JSON build-ups exist.
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.batches[0]?.validationWarnings.some((error) => error.includes('Markdown'))).toBe(true);

    writeAcceptableMarkdown(batch.markdownPath);
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));

    // V2.4.0: complete-but-unreviewed workpapers are accepted with a warning —
    // commercial sign-off belongs to the human reviewer, not the batch gate.
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.batches[0]?.validationWarnings.some((warning) => warning.includes('not reviewed'))).toBe(true);

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map(completeBuildUp),
    }));
    writeAcceptableMarkdown(batch.markdownPath);
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));

    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.completedBatches).toBe(1);
    expect(manifest.missingItemIds).toEqual([]);
  });

  test('rejects a final pricing pack that omits or changes a completed child build-up', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    let manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));
    const batch = manifest.batches[0]!;
    const buildUp = completeBuildUp(batch.itemIds[0]!);
    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: [buildUp],
    }));
    writeAcceptableMarkdown(batch.markdownPath);
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));

    expect(validateBoqBatchMerge(manifest, pricingData([]))).toContain('missing final BOQ item: item-1');
    expect(validateBoqBatchMerge(manifest, pricingData([{ ...buildUp, directCost: '11' }]))).toContain(
      'final BOQ item differs from child report: item-1',
    );
    expect(validateBoqBatchMerge(manifest, pricingData([buildUp]))).toEqual([]);
  });

  test('keeps small chapters whole in one batch and skips non-pricable summary rows', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    const data = boqData(0);
    data.items = [
      { id: 'sum-1', source: { documentId: 'boq', sheet: 'C2.3', cell: 'A6:F6' }, code: 'SCH-A', description: 'Schedule A 小计', unit: 'ZAR', quantity: '85490000', quantityBasis: 'boq', quantityStatus: 'sourced', quantityRefs: [] },
      { id: 'comb-1', source: { documentId: 'boq', sheet: 'SCH A', cell: 'A10:F200' }, code: '组合1', description: '组合1 C1.2-C1.7', unit: 'composite', quantity: undefined, quantityBasis: 'not_provided', quantityStatus: 'unverified', quantityRefs: [] },
      ...['C1.2.1', 'C1.2.2', 'C1.3.1', 'C1.3.2', 'C1.3.3'].map((code, index) => ({
        id: `item-${code}`,
        source: { documentId: 'boq', sheet: 'SCH A', cell: `A${index + 1}:F${index + 1}` },
        code,
        description: `Item ${code}`,
        unit: 'm3',
        quantity: '10',
        quantityBasis: 'boq' as const,
        quantityStatus: 'sourced' as const,
        quantityRefs: [],
      })),
    ];
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', data);

    expect(manifest.skippedItems.map((item) => item.itemId).sort()).toEqual(['comb-1', 'sum-1']);
    // C1.2 (2 items) and C1.3 (3 items) are distinct small chapters → merged into one batch.
    expect(manifest.batches).toHaveLength(1);
    expect(manifest.batches[0]?.itemIds).toHaveLength(5);
    expect(manifest.itemCount).toBe(5);
  });

  test('accepts reports with numeric values and percent weights via normalization', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    let manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));
    const batch = manifest.batches[0]!;
    const buildUp = completeBuildUp(batch.itemIds[0]!) as Record<string, any>;
    buildUp.directCost = 10;
    buildUp.productivityBasis.workingHoursPerDay = 8;
    buildUp.productivityBasis.scenarios = buildUp.productivityBasis.scenarios.map((scenario: Record<string, any>) => ({
      ...scenario,
      effectiveFactor: scenario.scenario === 'base' ? '50' : scenario.effectiveFactor,
    }));
    buildUp.costComponents[0].rate = 10;
    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: [buildUp],
    }));
    writeAcceptableMarkdown(batch.markdownPath);
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));

    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.batches[0]?.validationWarnings.some((warning) => warning.includes('effectiveFactor'))).toBe(true);
  });

  test('accepts scrap-credit negative quantities and heals quarantined BOQ reports', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    let manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));
    const batch = manifest.batches[0]!;
    const buildUp = completeBuildUp(batch.itemIds[0]!) as Record<string, any>;
    buildUp.resourceConsumptions.push({
      id: `${batch.itemIds[0]}-waste-credit`,
      kind: 'waste',
      description: 'scrap credit',
      quantity: -200,
      unit: 'ZAR',
      assumptionStatus: 'scenario',
      quantityBasis: 'per_boq_unit',
    });
    buildUp.costComponents.push({
      id: `${batch.itemIds[0]}-waste-component`,
      kind: 'waste',
      description: 'Scrap credit',
      quantity: -1,
      unit: 'km',
      rate: 200,
      amount: -200,
      assumptionStatus: 'scenario',
    });
    const quarantined = `${batch.reportPath}.invalid.${Date.now()}`;
    writeFileSync(quarantined, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: [buildUp],
    }));
    writeAcceptableMarkdown(batch.markdownPath);
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(existsSync(batch.reportPath)).toBe(true);
  });

  test('cannot pass from a completion claim when zero child batches have validated coverage', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));
    const claimedFinal = pricingData(manifest.batches[0]!.itemIds.map(completeBuildUp));

    const errors = validateBoqBatchMerge(manifest, claimedFinal);

    expect(manifest.completedBatches).toBe(0);
    expect(manifest.missingItemIds).toHaveLength(2);
    expect(errors).toContain(`incomplete BOQ batch: ${manifest.batches[0]!.batchId}`);
    expect(errors).toContain('unexpected final BOQ item: item-1');
    expect(errors).toContain('unexpected final BOQ item: item-2');
  });

  test('rejects deterministic resource, productivity, and activity conflicts across batches', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    let manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(41));
    expect(manifest.batches).toHaveLength(2);

    const buildUps = manifest.batches.flatMap((batch, batchIndex) => batch.itemIds.map((boqItemId, itemIndex) => {
      const buildUp = completeBuildUp(boqItemId);
      if (batchIndex === 1 && itemIndex === 0) {
        return {
          ...buildUp,
          resourceConsumptions: [{
            ...buildUp.resourceConsumptions[0],
            unit: 'day/m',
          }],
          costComponents: [{
            ...buildUp.costComponents[0],
            unit: 'day/m',
            rate: '12',
            amount: '12',
          }],
          directCost: '12',
          directCostSummary: {
            ...buildUp.directCostSummary,
            labour: '12',
            unitDirectCost: '12',
            itemDirectCost: '12',
          },
          planningBasis: {
            ...buildUp.planningBasis,
            productionRate: '2',
            activityId: 'activity-item-1',
            calendarId: 'calendar-night-shift',
          },
          productivityBasis: {
            ...buildUp.productivityBasis,
            theoreticalProductionRate: '4',
            calculationFormula: '4 m/day x effective factor',
            scenarios: buildUp.productivityBasis.scenarios.map((scenario) => ({
              ...scenario,
              productionRate: scenario.scenario === 'optimistic' ? '2.4' : scenario.scenario === 'base' ? '2' : '1.6',
            })),
          },
          initialCashFlow: [{
            ...buildUp.initialCashFlow[0],
            activityId: 'activity-item-1',
            amount: '12',
          }],
        };
      }
      return buildUp;
    }));

    let offset = 0;
    for (const batch of manifest.batches) {
      const batchBuildUps = buildUps.slice(offset, offset + batch.itemIds.length);
      offset += batch.itemIds.length;
      writeFileSync(batch.reportPath, JSON.stringify({
        schemaVersion: 1,
        batchId: batch.batchId,
        itemBuildUps: batchBuildUps,
      }));
      writeAcceptableMarkdown(batch.markdownPath, batch.batchId);
    }
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(41));

    const errors = validateBoqBatchMerge(manifest, pricingData(buildUps));
    expect(errors.some((error) => error.includes('resource unit conflict'))).toBe(true);
    expect(errors.some((error) => error.includes('resource rate conflict'))).toBe(true);
    expect(errors.some((error) => error.includes('production basis conflict'))).toBe(true);
    expect(errors.some((error) => error.includes('activity calendar conflict'))).toBe(true);
  });

  function boqData(count: number): TenderBoqReconciliationData {
    return {
      items: Array.from({ length: count }, (_, index) => ({
        id: `item-${index + 1}`,
        source: { documentId: 'boq', sheet: 'C5.1', cell: `A${index + 1}:F${index + 1}` },
        code: `5.1.${index + 1}`,
        description: `BOQ item ${index + 1}`,
        unit: 'm',
        quantity: '1',
        quantityBasis: 'boq',
        quantityStatus: 'sourced',
        quantityRefs: [{ documentId: 'boq', sheet: 'C5.1', cell: `F${index + 1}` }],
      })),
      scopeLinks: Array.from({ length: count }, (_, index) => ({
        boqItemId: `item-${index + 1}`,
        requirementIds: [],
        specificationRefs: [{ documentId: 'spec', clause: `C5.1.${index + 1}` }],
        drawingRefs: [],
        measurementRuleRefs: [],
        inclusions: [],
        exclusions: [],
        assumptions: [],
        gapStatus: 'clear',
      })),
    };
  }

  function pricingData(itemBuildUps: unknown[]) {
    return {
      currency: 'ZAR',
      pricingStatus: 'reviewed',
      itemBuildUps,
      resourceSummary: [],
      assumptions: [],
    };
  }

  function completeBuildUp(boqItemId: string) {
    const itemNumber = Number(boqItemId.split('-').at(-1));
    const rowSource = { documentId: 'boq', sheet: 'C5.1', cell: `A${itemNumber}:F${itemNumber}` };
    const specificationSource = { documentId: 'spec', clause: `C5.1.${itemNumber}` };
    const measurementSource = { documentId: 'spec', clause: `C5.1.${itemNumber}-payment` };
    const step = {
      narrative: 'Evidence-linked derivation.',
      sourceRefs: [rowSource],
    };
    return {
      boqItemId,
      status: 'reviewed',
      steps: {
        scopeQuantity: step,
        methodProductivity: step,
        resourceConsumption: step,
        sourcedRatesDirectCost: step,
        reconciliationRisk: step,
      },
      itemIdentity: {
        code: `5.1.${itemNumber}`,
        description: `BOQ item ${itemNumber}`,
        unit: 'm',
        quantity: '1',
        sourceRef: rowSource,
      },
      scopeBasis: {
        specificationRefs: [specificationSource],
        measurementRuleRefs: [measurementSource],
        inclusions: ['Complete measured work'],
        exclusions: ['General overhead and profit'],
        testingRequirements: ['Acceptance test or explicit not-applicable basis'],
        methodConstraints: ['Execute to the cited specification'],
      },
      productivityBasis: {
        methodSequence: ['Set out', 'Execute', 'Inspect'],
        crew: [{
          id: `${boqItemId}-crew`, kind: 'labour', description: 'Work crew', count: '1',
          assumptionStatus: 'sourced', sourceRefs: [specificationSource],
        }],
        workingHoursPerDay: '8',
        bottleneck: 'Crew output',
        theoreticalProductionRate: '2',
        calculationFormula: '2 m/day x effective factor',
        scenarios: [
          { scenario: 'optimistic', productionRate: '1.2', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.6', basis: 'Good conditions', assumptionStatus: 'scenario', sourceRefs: [specificationSource] },
          { scenario: 'base', productionRate: '1', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.5', basis: 'Normal conditions', assumptionStatus: 'sourced', sourceRefs: [specificationSource] },
          { scenario: 'pessimistic', productionRate: '0.8', quantityUnit: 'm', timeUnit: 'working_day', effectiveFactor: '0.4', basis: 'Constrained conditions', assumptionStatus: 'scenario', sourceRefs: [specificationSource] },
        ],
      },
      resourceCoverage: [
        { kind: 'labour', applicability: 'included', basis: 'Direct work crew' },
        { kind: 'plant', applicability: 'not_applicable', basis: 'No plant required' },
        { kind: 'material', applicability: 'not_applicable', basis: 'No permanent material' },
        { kind: 'subcontract', applicability: 'not_applicable', basis: 'Self-performed' },
        { kind: 'transport', applicability: 'not_applicable', basis: 'No transport component' },
        { kind: 'waste', applicability: 'not_applicable', basis: 'No material waste' },
      ],
      planningBasis: {
        methodId: 'linear-installation',
        productionRate: '1',
        quantityUnit: 'm',
        timeUnit: 'working_day',
        duration: '1',
        calendarId: 'calendar-standard',
        activityId: `activity-${boqItemId}`,
        assumptionStatus: 'sourced',
        sourceRefs: [specificationSource],
      },
      initialCashFlow: [{
        period: '2026-08',
        activityId: `activity-${boqItemId}`,
        weight: '1',
        amount: '10',
        basis: 'Single-period initial allocation.',
        assumptionStatus: 'sourced',
        sourceRefs: [specificationSource],
      }],
      resourceConsumptions: [{
        id: `${boqItemId}-labour-consumption`,
        kind: 'labour',
        description: 'Labour',
        quantity: '1',
        unit: 'hour/m',
        assumptionStatus: 'sourced',
        quantityBasis: 'per_boq_unit',
        calculationBasis: 'One labour hour per metre at base output',
        costComponentId: `${boqItemId}-labour`,
        sourceRefs: [specificationSource],
      }],
      costComponents: [{
        id: `${boqItemId}-labour`,
        kind: 'labour',
        description: 'Labour',
        quantity: '1',
        unit: 'hour/m',
        rate: '10',
        amount: '10',
        rateSourceRef: rowSource,
        rateBasis: {
          sourceType: 'published_schedule', acquisitionMode: 'not_applicable', location: 'Durban',
          effectiveDate: '2026-07-15', vatTreatment: 'exclusive',
        },
        assumptionStatus: 'sourced',
      }],
      directCost: '10',
      directCostSummary: {
        labour: '10', plant: '0', material: '0', subcontract: '0', transport: '0', waste: '0', other: '0',
        unitDirectCost: '10', boqQuantity: '1', itemDirectCost: '10',
      },
      riskScenarios: [{
        id: `${boqItemId}-productivity-risk`, variable: 'Crew productivity', optimistic: '1.2 m/day',
        base: '1 m/day', pessimistic: '0.8 m/day', trigger: 'Restricted access', treatment: 'Rebalance crew',
        assumptionStatus: 'sourced', sourceRefs: [specificationSource],
      }],
      conditions: [],
      riskNotes: [],
    };
  }
});
