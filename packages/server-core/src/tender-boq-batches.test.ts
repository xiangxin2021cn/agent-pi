import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TenderBoqReconciliationData } from '@agent-pi/business-core/tender';
import {
  createOrRefreshBoqBatchManifest,
  validateBoqBatchMerge,
  type TenderBoqBatchBrief,
} from './tender-boq-batches.ts';

describe('tender BOQ batch manifest', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('splits BOQ work by source sheet and a maximum of 12 ordered C5.1 items', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(45), new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
      ['spec', 'C:/inputs/Specification.pdf'],
    ]));

    expect(manifest.itemCount).toBe(45);
    expect(manifest.batches).toHaveLength(4);
    expect(manifest.batches.map((batch) => batch.itemIds.length)).toEqual([12, 12, 12, 9]);
    expect(manifest.batches[0]?.source.sheet).toBe('C5.1');
    expect(manifest.batches[0]?.source.firstCell).toBe('A1:F1');
    expect(manifest.batches[0]?.source.lastCell).toBe('A12:F12');

    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderBoqBatchBrief;
    expect(Object.keys(brief).sort()).toEqual([
      'allowedSources', 'batchId', 'finalArtifactPolicy', 'itemIds', 'items', 'objective',
      'outputSchema', 'projectId', 'qualityStandard', 'reportPath', 'schemaVersion', 'scope', 'spawnPolicy',
    ]);
    expect(brief.itemIds).toEqual(manifest.batches[0]?.itemIds);
    expect(brief.spawnPolicy).toBe('forbidden');
    expect(brief.finalArtifactPolicy).toBe('report-only');
    expect(brief.qualityStandard.id).toBe('c51_pure_direct_cost_v1');
    expect(brief.items[0]?.item.code).toBe('5.1.1');
    expect(brief.allowedSources.map((source) => source.documentId).sort()).toEqual(['boq', 'spec']);
    expect(brief.allowedSources).toContainEqual({ documentId: 'boq', path: 'C:/inputs/BOQ.xlsx' });
    expect(brief.allowedSources).toContainEqual({ documentId: 'spec', path: 'C:/inputs/Specification.pdf' });
    const itemSchema = (brief.outputSchema.properties as Record<string, any>).itemBuildUps.items;
    expect(itemSchema.required).toContain('planningBasis');
    expect(itemSchema.required).toContain('productivityBasis');
    expect(itemSchema.required).toContain('directCostSummary');
    expect(itemSchema.required).not.toContain('initialCashFlow');
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
    expect(manifest.batches[0]?.status).toBe('invalid');
    expect(manifest.completedBatches).toBe(0);

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map((boqItemId) => ({ boqItemId })),
    }));
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));

    expect(manifest.batches[0]?.status).toBe('invalid');

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map((itemId) => ({ ...completeBuildUp(itemId), status: 'draft' })),
    }));
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(2));

    expect(manifest.batches[0]?.status).toBe('invalid');

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      itemBuildUps: batch.itemIds.map(completeBuildUp),
    }));
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
    manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(1));

    expect(validateBoqBatchMerge(manifest, pricingData([]))).toContain('missing final BOQ item: item-1');
    expect(validateBoqBatchMerge(manifest, pricingData([{ ...buildUp, directCost: '11' }]))).toContain(
      'final BOQ item differs from child report: item-1',
    );
    expect(validateBoqBatchMerge(manifest, pricingData([buildUp]))).toEqual([]);
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
    expect(manifest.batches).toHaveLength(4);

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
