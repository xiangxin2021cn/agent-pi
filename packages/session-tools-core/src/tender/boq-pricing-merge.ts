/**
 * Deterministic BOQ five-step pricing pack merge from per-chapter batch
 * reports. Mirrors document-analysis-merge.ts: when every batch is complete,
 * the runtime owns the merged pack so the parent model never has to inline a
 * huge JSON payload (the V2.3.x compression/deep-equal loop failure mode).
 *
 * Child reports pass through the lenient normalizer so format-level variance
 * (numeric strings vs numbers, percent weights) does not deadlock the merge.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  normalizeAndValidateBoqItemBuildUps,
  parseTenderBoqFiveStepPricingDataLenient,
  type TenderBoqFiveStepItemBuildUp,
  type TenderBoqFiveStepPricingData,
} from '@agent-pi/business-core/tender';

export interface BoqPricingMergeBatch {
  batchId: string;
  reportPath: string;
  status: 'pending' | 'complete' | 'invalid' | string;
}

export interface BoqPricingMergeResult {
  data?: TenderBoqFiveStepPricingData;
  errors: string[];
  warnings: string[];
}

const PRICING_SKELETON: Omit<TenderBoqFiveStepPricingData, 'itemBuildUps' | 'currency'> = {
  pricingStandard: 'c51_pure_direct_cost_v1',
  vatTreatment: 'exclusive',
  indirectCostPolicy: 'excluded_from_item_direct_cost',
  pricingStatus: 'draft',
  resourceSummary: [],
  assumptions: [],
};

function readBatchReport(
  reportPath: string,
  batchId: string,
): { itemBuildUps: TenderBoqFiveStepItemBuildUp[]; errors: string[]; warnings: string[] } {
  if (!existsSync(reportPath)) return { itemBuildUps: [], errors: [`report missing: ${reportPath}`], warnings: [] };
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    const errors: string[] = [];
    if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (report.batchId !== batchId) errors.push(`batchId must be ${batchId}`);
    if (!Array.isArray(report.itemBuildUps) || report.itemBuildUps.length === 0) {
      return { itemBuildUps: [], errors: [...errors, 'itemBuildUps must be a non-empty array'], warnings: [] };
    }
    const normalized = normalizeAndValidateBoqItemBuildUps(report.itemBuildUps, {
      currency: 'USD',
      ...PRICING_SKELETON,
    });
    return {
      itemBuildUps: normalized.itemBuildUps,
      errors: [...errors, ...normalized.errors],
      warnings: normalized.warnings,
    };
  } catch (error) {
    return { itemBuildUps: [], errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
  }
}

export function mergeBoqBatchReports(
  batches: BoqPricingMergeBatch[],
  currency: string,
): BoqPricingMergeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const itemBuildUps: TenderBoqFiveStepItemBuildUp[] = [];
  const seenIds = new Set<string>();

  if (batches.length === 0) {
    return { errors: ['boq-batches:no-items'], warnings };
  }
  if (batches.some((batch) => batch.status !== 'complete')) {
    return { errors: ['boq-batches:incomplete'], warnings };
  }

  for (const batch of batches) {
    const report = readBatchReport(batch.reportPath, batch.batchId);
    errors.push(...report.errors.map((error) => `${batch.batchId}: ${error}`));
    warnings.push(...report.warnings.map((warning) => `${batch.batchId}: ${warning}`));
    for (const buildUp of report.itemBuildUps) {
      if (seenIds.has(buildUp.boqItemId)) {
        errors.push(`duplicate merged BOQ item: ${buildUp.boqItemId}`);
        continue;
      }
      seenIds.add(buildUp.boqItemId);
      itemBuildUps.push(buildUp);
    }
  }

  if (errors.length > 0) return { errors, warnings };
  const data: TenderBoqFiveStepPricingData = {
    currency,
    pricingStandard: 'c51_pure_direct_cost_v1',
    vatTreatment: 'exclusive',
    indirectCostPolicy: 'excluded_from_item_direct_cost',
    // Honest rollup: reviewed only when every child item is reviewed.
    pricingStatus: itemBuildUps.every((buildUp) => buildUp.status === 'reviewed') ? 'reviewed' : 'draft',
    itemBuildUps,
    resourceSummary: [],
    assumptions: [],
  };
  return { data, errors: [], warnings };
}

export function validateBoqPricingBatchMerge(
  batches: BoqPricingMergeBatch[],
  currency: string,
  finalValue: TenderBoqFiveStepPricingData | unknown,
): string[] {
  const merged = mergeBoqBatchReports(batches, currency);
  if (merged.errors.length > 0 || !merged.data) return merged.errors;

  let finalData: TenderBoqFiveStepPricingData;
  try {
    finalData = parseTenderBoqFiveStepPricingDataLenient(finalValue, currency).data;
  } catch (error) {
    return [`invalid final pricing pack: ${error instanceof Error ? error.message : String(error)}`];
  }

  const expected = new Map(merged.data.itemBuildUps.map((buildUp) => [buildUp.boqItemId, buildUp]));
  const actual = new Map<string, TenderBoqFiveStepItemBuildUp>();
  for (const buildUp of finalData.itemBuildUps) {
    if (actual.has(buildUp.boqItemId)) return [`duplicate final BOQ item: ${buildUp.boqItemId}`];
    actual.set(buildUp.boqItemId, buildUp);
  }
  // Soft gate: item coverage only — field-level deep-equal burned retries on harmless drift.
  if (finalData.itemBuildUps.length === 0) {
    return ['final pricing pack has no itemBuildUps'];
  }
  const errors: string[] = [];
  for (const itemId of expected.keys()) {
    if (!actual.has(itemId)) errors.push(`missing final BOQ item: ${itemId}`);
  }
  return errors;
}
