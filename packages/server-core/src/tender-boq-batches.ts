import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  parseTenderBoqFiveStepPricingData,
  decimalStringsEqual,
  type TenderBoqReconciliationData,
  type TenderBoqFiveStepItemBuildUp,
  type TenderBoqFiveStepPricingData,
  type TenderSourceLocator,
} from '@agent-pi/business-core/tender';

export interface TenderBoqBatchBrief {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  objective: string;
  scope: {
    documentId: string;
    sheet: string;
    firstCell?: string;
    lastCell?: string;
  };
  itemIds: string[];
  allowedSources: Array<{ documentId: string; path?: string }>;
  outputSchema: Record<string, unknown>;
  reportPath: string;
  spawnPolicy: 'forbidden';
  finalArtifactPolicy: 'report-only';
}

export interface TenderBoqBatchRecord {
  batchId: string;
  source: TenderBoqBatchBrief['scope'];
  itemIds: string[];
  allowedDocumentIds: string[];
  briefPath: string;
  reportPath: string;
  status: 'pending' | 'complete' | 'invalid';
  validationErrors: string[];
}

export interface TenderBoqBatchManifest {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  itemCount: number;
  batchCount: number;
  completedBatches: number;
  missingItemIds: string[];
  batches: TenderBoqBatchRecord[];
  manifestPath: string;
}

const MAX_ITEMS_PER_BATCH = 40;

export function createOrRefreshBoqBatchManifest(
  projectDirectory: string,
  projectId: string,
  boq: TenderBoqReconciliationData,
  sourcePathByDocumentId: ReadonlyMap<string, string> = new Map(),
): TenderBoqBatchManifest {
  const briefDirectory = join(projectDirectory, 'orchestration', 'briefs', 'boq-pricing');
  const reportDirectory = join(projectDirectory, 'orchestration', 'reports', 'boq-pricing');
  const manifestPath = join(projectDirectory, 'boq-batch-manifest.json');
  mkdirSync(briefDirectory, { recursive: true });
  mkdirSync(reportDirectory, { recursive: true });

  const scopeLinkByItemId = new Map(boq.scopeLinks.map((link) => [link.boqItemId, link]));
  const grouped = new Map<string, typeof boq.items>();
  for (const item of boq.items) {
    const key = `${item.source.documentId}\u0000${item.source.sheet ?? '(unspecified)'}`;
    const items = grouped.get(key) ?? [];
    items.push(item);
    grouped.set(key, items);
  }

  const batches: TenderBoqBatchRecord[] = [];
  for (const items of grouped.values()) {
    for (let start = 0; start < items.length; start += MAX_ITEMS_PER_BATCH) {
      const chunk = items.slice(start, start + MAX_ITEMS_PER_BATCH);
      const first = chunk[0]!;
      const last = chunk[chunk.length - 1]!;
      const sheet = first.source.sheet ?? '(unspecified)';
      const batchNumber = Math.floor(start / MAX_ITEMS_PER_BATCH) + 1;
      const batchId = createBatchId(first.source.documentId, sheet, batchNumber);
      const briefPath = join(briefDirectory, `${batchId}.json`);
      const reportPath = join(reportDirectory, `${batchId}.json`);
      const itemIds = chunk.map((item) => item.id);
      const allowedDocumentIds = collectAllowedDocumentIds(chunk, scopeLinkByItemId);
      const scope = {
        documentId: first.source.documentId,
        sheet,
        firstCell: first.source.cell,
        lastCell: last.source.cell,
      };
      const brief: TenderBoqBatchBrief = {
        schemaVersion: 1,
        projectId,
        batchId,
        objective: 'Produce complete five-step pricing build-ups for exactly the assigned BOQ item IDs.',
        scope,
        itemIds,
        allowedSources: allowedDocumentIds.map((documentId) => ({
          documentId,
          ...(sourcePathByDocumentId.get(documentId) ? { path: sourcePathByDocumentId.get(documentId) } : {}),
        })),
        outputSchema: batchReportSchema(batchId, itemIds),
        reportPath,
        spawnPolicy: 'forbidden',
        finalArtifactPolicy: 'report-only',
      };
      atomicWriteJson(briefPath, brief);
      const validation = validateBatchReport(reportPath, batchId, itemIds);
      batches.push({
        batchId,
        source: scope,
        itemIds,
        allowedDocumentIds,
        briefPath,
        reportPath,
        status: validation.status,
        validationErrors: validation.errors,
      });
    }
  }

  const completeItemIds = new Set(
    batches.filter((batch) => batch.status === 'complete').flatMap((batch) => batch.itemIds),
  );
  const manifest: TenderBoqBatchManifest = {
    schemaVersion: 1,
    projectId,
    generatedAt: new Date().toISOString(),
    itemCount: boq.items.length,
    batchCount: batches.length,
    completedBatches: batches.filter((batch) => batch.status === 'complete').length,
    missingItemIds: boq.items.map((item) => item.id).filter((itemId) => !completeItemIds.has(itemId)),
    batches,
    manifestPath,
  };
  atomicWriteJson(manifestPath, manifest);
  return manifest;
}

export function validateBoqBatchMerge(
  manifest: TenderBoqBatchManifest,
  finalValue: TenderBoqFiveStepPricingData | unknown,
): string[] {
  const errors: string[] = [];
  let finalData: TenderBoqFiveStepPricingData;
  try {
    finalData = parseTenderBoqFiveStepPricingData(finalValue);
  } catch (error) {
    return [`invalid final pricing pack: ${error instanceof Error ? error.message : String(error)}`];
  }

  const reportedByItemId = new Map<string, TenderBoqFiveStepItemBuildUp>();
  const reportedEntries: Array<{ batchId: string; buildUp: TenderBoqFiveStepItemBuildUp }> = [];
  for (const batch of manifest.batches) {
    if (batch.status !== 'complete') {
      errors.push(`incomplete BOQ batch: ${batch.batchId}`);
      continue;
    }
    const report = readBatchReport(batch.reportPath, batch.batchId, batch.itemIds);
    if (report.errors.length > 0) {
      errors.push(...report.errors.map((error) => `${batch.batchId}: ${error}`));
      continue;
    }
    for (const buildUp of report.itemBuildUps) {
      if (reportedByItemId.has(buildUp.boqItemId)) errors.push(`duplicate child BOQ item: ${buildUp.boqItemId}`);
      else {
        reportedByItemId.set(buildUp.boqItemId, buildUp);
        reportedEntries.push({ batchId: batch.batchId, buildUp });
      }
    }
  }

  errors.push(...detectCrossBatchSemanticConflicts(reportedEntries));

  const finalByItemId = new Map(finalData.itemBuildUps.map((buildUp) => [buildUp.boqItemId, buildUp]));
  for (const [itemId, reported] of reportedByItemId) {
    const finalBuildUp = finalByItemId.get(itemId);
    if (!finalBuildUp) errors.push(`missing final BOQ item: ${itemId}`);
    else if (!isDeepStrictEqual(finalBuildUp, reported)) errors.push(`final BOQ item differs from child report: ${itemId}`);
  }
  for (const itemId of finalByItemId.keys()) {
    if (!reportedByItemId.has(itemId)) errors.push(`unexpected final BOQ item: ${itemId}`);
  }
  return errors;
}

function collectAllowedDocumentIds(
  items: TenderBoqReconciliationData['items'],
  scopeLinkByItemId: Map<string, TenderBoqReconciliationData['scopeLinks'][number]>,
): string[] {
  const documentIds = new Set<string>();
  const add = (sources: TenderSourceLocator[]) => sources.forEach((source) => documentIds.add(source.documentId));
  for (const item of items) {
    documentIds.add(item.source.documentId);
    add(item.quantityRefs);
    const link = scopeLinkByItemId.get(item.id);
    if (!link) continue;
    add(link.specificationRefs);
    add(link.drawingRefs);
    add(link.measurementRuleRefs);
    link.assumptions.forEach((assumption) => add(assumption.sourceRefs));
  }
  return [...documentIds].sort();
}

function validateBatchReport(
  reportPath: string,
  batchId: string,
  itemIds: string[],
): { status: TenderBoqBatchRecord['status']; errors: string[] } {
  if (!existsSync(reportPath)) return { status: 'pending', errors: [] };
  try {
    const { errors } = readBatchReport(reportPath, batchId, itemIds);
    return { status: errors.length === 0 ? 'complete' : 'invalid', errors };
  } catch (error) {
    return { status: 'invalid', errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function readBatchReport(
  reportPath: string,
  batchId: string,
  itemIds: string[],
): { itemBuildUps: TenderBoqFiveStepItemBuildUp[]; errors: string[] } {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    schemaVersion?: unknown;
    batchId?: unknown;
    itemBuildUps?: unknown;
  };
  const errors: string[] = [];
  if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (report.batchId !== batchId) errors.push(`batchId must be ${batchId}`);
  if (!Array.isArray(report.itemBuildUps)) {
    errors.push('itemBuildUps must be an array');
    return { itemBuildUps: [], errors };
  }

  let itemBuildUps: TenderBoqFiveStepItemBuildUp[] = [];
  try {
    itemBuildUps = parseTenderBoqFiveStepPricingData({
      currency: 'USD',
      pricingStatus: 'reviewed',
      itemBuildUps: report.itemBuildUps,
      resourceSummary: [],
      assumptions: [],
    }).itemBuildUps;
  } catch (error) {
    errors.push(`itemBuildUps schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const buildUp of itemBuildUps) {
    if (!buildUp.planningBasis) errors.push(`BOQ item ${buildUp.boqItemId} is missing planningBasis`);
    if (!buildUp.initialCashFlow || buildUp.initialCashFlow.length === 0) {
      errors.push(`BOQ item ${buildUp.boqItemId} is missing initialCashFlow`);
    }
  }
  const actualIds = itemBuildUps.map((item) => item.boqItemId);
  const expected = new Set(itemIds);
  const actual = new Set(actualIds);
  const missing = itemIds.filter((itemId) => !actual.has(itemId));
  const extras = actualIds.filter((itemId) => !expected.has(itemId));
  if (actualIds.length !== actual.size) errors.push('itemBuildUps contains duplicate BOQ item IDs');
  if (missing.length > 0) errors.push(`missing BOQ item IDs: ${missing.join(', ')}`);
  if (extras.length > 0) errors.push(`unexpected BOQ item IDs: ${extras.join(', ')}`);
  return { itemBuildUps, errors };
}

function createBatchId(documentId: string, sheet: string, batchNumber: number): string {
  const slug = sheet.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sheet';
  const hash = createHash('sha256').update(`${documentId}\u0000${sheet}`).digest('hex').slice(0, 8);
  return `boq-${slug.slice(0, 36)}-${hash}-${String(batchNumber).padStart(3, '0')}`;
}

function batchReportSchema(batchId: string, itemIds: string[]): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'batchId', 'itemBuildUps'],
    properties: {
      schemaVersion: { const: 1 },
      batchId: { const: batchId },
      itemBuildUps: {
        type: 'array',
        minItems: itemIds.length,
        maxItems: itemIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'boqItemId', 'status', 'steps', 'resourceConsumptions', 'planningBasis',
            'initialCashFlow', 'costComponents', 'directCost', 'conditions', 'riskNotes',
          ],
          properties: {
            boqItemId: { enum: itemIds },
            status: { enum: ['draft', 'reviewed', 'blocked'] },
            steps: {
              type: 'object',
              required: ['scopeQuantity', 'methodProductivity', 'resourceConsumption', 'sourcedRatesDirectCost', 'reconciliationRisk'],
            },
            resourceConsumptions: { type: 'array' },
            planningBasis: {
              type: 'object',
              additionalProperties: false,
              required: [
                'methodId', 'productionRate', 'quantityUnit', 'timeUnit', 'duration',
                'calendarId', 'activityId', 'assumptionStatus', 'sourceRefs',
              ],
              properties: {
                methodId: { type: 'string' },
                productionRate: { type: 'string', description: 'Quantity units produced per timeUnit.' },
                quantityUnit: { type: 'string' },
                timeUnit: { enum: ['hour', 'shift', 'working_day', 'week'] },
                duration: { type: 'string', description: 'Calculated duration in timeUnit.' },
                calendarId: { type: 'string' },
                activityId: { type: 'string' },
                assumptionStatus: { enum: ['sourced', 'scenario', 'unverified'] },
                sourceRefs: { type: 'array', minItems: 1 },
              },
            },
            initialCashFlow: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['period', 'activityId', 'weight', 'amount', 'basis', 'assumptionStatus', 'sourceRefs'],
                properties: {
                  period: { type: 'string', pattern: '^\\d{4}-(?:0[1-9]|1[0-2])$' },
                  activityId: { type: 'string' },
                  weight: { type: 'string', description: 'Exact fraction of item direct cost allocated to the period.' },
                  amount: { type: 'string' },
                  basis: { type: 'string' },
                  assumptionStatus: { enum: ['sourced', 'scenario', 'unverified'] },
                  sourceRefs: { type: 'array', minItems: 1 },
                },
              },
            },
            costComponents: { type: 'array' },
            directCost: { type: 'string' },
            conditions: { type: 'array', items: { type: 'string' } },
            riskNotes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}

function detectCrossBatchSemanticConflicts(
  entries: Array<{ batchId: string; buildUp: TenderBoqFiveStepItemBuildUp }>,
): string[] {
  const errors: string[] = [];
  const resources = new Map<string, { batchId: string; itemId: string; unit: string }>();
  const rates = new Map<string, { batchId: string; itemId: string; unit: string; rate: string }>();
  const methods = new Map<string, {
    batchId: string;
    itemId: string;
    productionRate: string;
    quantityUnit: string;
    timeUnit: string;
  }>();
  const activities = new Map<string, { batchId: string; itemId: string; calendarId: string }>();

  for (const { batchId, buildUp } of entries) {
    for (const resource of buildUp.resourceConsumptions) {
      const key = `${resource.kind}|${normalizeSemanticText(resource.description)}`;
      const unit = normalizeUnit(resource.unit);
      const previous = resources.get(key);
      if (previous && previous.batchId !== batchId && previous.unit !== unit) {
        errors.push(
          `resource unit conflict for ${resource.kind} ${resource.description}: `
          + `${previous.itemId} uses ${previous.unit}, ${buildUp.boqItemId} uses ${unit}`,
        );
      } else if (!previous) {
        resources.set(key, { batchId, itemId: buildUp.boqItemId, unit });
      }
    }

    for (const component of buildUp.costComponents) {
      const key = `${component.kind}|${normalizeSemanticText(component.description)}`;
      const unit = normalizeUnit(component.unit);
      const previous = rates.get(key);
      if (previous && previous.batchId !== batchId) {
        if (previous.unit !== unit) {
          errors.push(
            `resource unit conflict for ${component.kind} ${component.description}: `
            + `${previous.itemId} uses ${previous.unit}, ${buildUp.boqItemId} uses ${unit}`,
          );
        }
        if (!decimalStringsEqual(previous.rate, component.rate)) {
          errors.push(
            `resource rate conflict for ${component.kind} ${component.description}: `
            + `${previous.itemId} uses ${previous.rate}, ${buildUp.boqItemId} uses ${component.rate}`,
          );
        }
      } else if (!previous) {
        rates.set(key, { batchId, itemId: buildUp.boqItemId, unit, rate: component.rate });
      }
    }

    const planning = buildUp.planningBasis;
    if (!planning) continue;
    const methodKey = normalizeSemanticText(planning.methodId);
    const previousMethod = methods.get(methodKey);
    if (previousMethod && previousMethod.batchId !== batchId && (
      !decimalStringsEqual(previousMethod.productionRate, planning.productionRate)
      || previousMethod.quantityUnit !== normalizeUnit(planning.quantityUnit)
      || previousMethod.timeUnit !== planning.timeUnit
    )) {
      errors.push(
        `production basis conflict for method ${planning.methodId}: `
        + `${previousMethod.itemId} uses ${previousMethod.productionRate} ${previousMethod.quantityUnit}/${previousMethod.timeUnit}, `
        + `${buildUp.boqItemId} uses ${planning.productionRate} ${normalizeUnit(planning.quantityUnit)}/${planning.timeUnit}`,
      );
    } else if (!previousMethod) {
      methods.set(methodKey, {
        batchId,
        itemId: buildUp.boqItemId,
        productionRate: planning.productionRate,
        quantityUnit: normalizeUnit(planning.quantityUnit),
        timeUnit: planning.timeUnit,
      });
    }

    const activityKey = normalizeSemanticText(planning.activityId);
    const previousActivity = activities.get(activityKey);
    if (previousActivity && previousActivity.batchId !== batchId && previousActivity.calendarId !== planning.calendarId) {
      errors.push(
        `activity calendar conflict for ${planning.activityId}: `
        + `${previousActivity.itemId} uses ${previousActivity.calendarId}, `
        + `${buildUp.boqItemId} uses ${planning.calendarId}`,
      );
    } else if (!previousActivity) {
      activities.set(activityKey, {
        batchId,
        itemId: buildUp.boqItemId,
        calendarId: planning.calendarId,
      });
    }
  }
  return errors;
}

function normalizeSemanticText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUnit(value: string): string {
  return normalizeSemanticText(value).replace(/\s+/g, '').replace(/³/g, '3').replace(/²/g, '2');
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}
