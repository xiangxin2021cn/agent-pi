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

  test('splits BOQ work by source sheet and a maximum of 40 ordered items', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-boq-batches-'));
    const manifest = createOrRefreshBoqBatchManifest(root, 'n3', boqData(45), new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
      ['spec', 'C:/inputs/Specification.pdf'],
    ]));

    expect(manifest.itemCount).toBe(45);
    expect(manifest.batches).toHaveLength(2);
    expect(manifest.batches.map((batch) => batch.itemIds.length)).toEqual([40, 5]);
    expect(manifest.batches[0]?.source.sheet).toBe('C5.1');
    expect(manifest.batches[0]?.source.firstCell).toBe('A1:F1');
    expect(manifest.batches[0]?.source.lastCell).toBe('A40:F40');

    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderBoqBatchBrief;
    expect(Object.keys(brief).sort()).toEqual([
      'allowedSources', 'batchId', 'finalArtifactPolicy', 'itemIds', 'objective',
      'outputSchema', 'projectId', 'reportPath', 'schemaVersion', 'scope', 'spawnPolicy',
    ]);
    expect(brief.itemIds).toEqual(manifest.batches[0]?.itemIds);
    expect(brief.spawnPolicy).toBe('forbidden');
    expect(brief.finalArtifactPolicy).toBe('report-only');
    expect(brief.allowedSources.map((source) => source.documentId).sort()).toEqual(['boq', 'spec']);
    expect(brief.allowedSources).toContainEqual({ documentId: 'boq', path: 'C:/inputs/BOQ.xlsx' });
    expect(brief.allowedSources).toContainEqual({ documentId: 'spec', path: 'C:/inputs/Specification.pdf' });
    const itemSchema = (brief.outputSchema.properties as Record<string, any>).itemBuildUps.items;
    expect(itemSchema.required).toContain('planningBasis');
    expect(itemSchema.required).toContain('initialCashFlow');
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
            rate: '12',
            amount: '12',
          }],
          directCost: '12',
          planningBasis: {
            ...buildUp.planningBasis,
            productionRate: '2',
            activityId: 'activity-item-1',
            calendarId: 'calendar-night-shift',
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
    const step = {
      narrative: 'Evidence-linked derivation.',
      sourceRefs: [{ documentId: 'boq', sheet: 'C5.1', cell: 'A1:F1' }],
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
      planningBasis: {
        methodId: 'linear-installation',
        productionRate: '1',
        quantityUnit: 'm',
        timeUnit: 'working_day',
        duration: '1',
        calendarId: 'calendar-standard',
        activityId: `activity-${boqItemId}`,
        assumptionStatus: 'sourced',
        sourceRefs: [{ documentId: 'boq', sheet: 'C5.1', cell: 'A1:F1' }],
      },
      initialCashFlow: [{
        period: '2026-08',
        activityId: `activity-${boqItemId}`,
        weight: '1',
        amount: '10',
        basis: 'Single-period initial allocation.',
        assumptionStatus: 'sourced',
        sourceRefs: [{ documentId: 'boq', sheet: 'C5.1', cell: 'A1:F1' }],
      }],
      resourceConsumptions: [{
        id: `${boqItemId}-labour-consumption`,
        kind: 'labour',
        description: 'Labour',
        quantity: '1',
        unit: 'hour/m',
        assumptionStatus: 'sourced',
      }],
      costComponents: [{
        id: `${boqItemId}-labour`,
        kind: 'labour',
        description: 'Labour',
        quantity: '1',
        unit: 'hour',
        rate: '10',
        amount: '10',
        rateSourceRef: { documentId: 'boq', sheet: 'C5.1', cell: 'A1:F1' },
        assumptionStatus: 'sourced',
      }],
      directCost: '10',
      conditions: [],
      riskNotes: [],
    };
  }
});
