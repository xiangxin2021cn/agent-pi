import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aggregateConstructionResourceSchedule,
  writeConstructionResourceScheduleArtifacts,
} from './tender-resource-schedule.ts';

describe('construction resource schedule aggregation', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('sums resourceConsumptions by kind/name/unit across BOQ quantities', () => {
    const data = aggregateConstructionResourceSchedule({
      currency: 'ZAR',
      itemBuildUps: [
        {
          boqItemId: 'item-1',
          status: 'reviewed',
          steps: {} as never,
          itemIdentity: {
            code: '5.1.1', description: 'A', unit: 'm', quantity: '10',
            sourceRef: { documentId: 'boq' },
          },
          resourceConsumptions: [{
            id: 'c1', kind: 'labour', description: 'Labour', quantity: '2', unit: 'hour/m',
            assumptionStatus: 'sourced', quantityBasis: 'per_boq_unit', calculationBasis: '2h',
            costComponentId: 'lab', sourceRefs: [],
          }],
          costComponents: [{
            id: 'lab', kind: 'labour', description: 'Labour', quantity: '2', unit: 'hour/m',
            rate: '50', amount: '100', rateSourceRef: { documentId: 'boq' },
            rateBasis: {
              sourceType: 'published_schedule', acquisitionMode: 'not_applicable',
              location: 'Durban', effectiveDate: '2026-07-16', vatTreatment: 'exclusive',
            },
            assumptionStatus: 'sourced',
          }],
          directCost: '100',
          conditions: [],
          riskNotes: [],
        },
        {
          boqItemId: 'item-2',
          status: 'reviewed',
          steps: {} as never,
          itemIdentity: {
            code: '5.1.2', description: 'B', unit: 'm', quantity: '5',
            sourceRef: { documentId: 'boq' },
          },
          resourceConsumptions: [{
            id: 'c2', kind: 'labour', description: 'Labour', quantity: '2', unit: 'hour/m',
            assumptionStatus: 'unverified', quantityBasis: 'per_boq_unit', calculationBasis: '2h',
            costComponentId: 'lab', sourceRefs: [],
          }],
          costComponents: [{
            id: 'lab', kind: 'labour', description: 'Labour', quantity: '2', unit: 'hour/m',
            rate: '50', amount: '100', rateSourceRef: { documentId: 'boq' },
            rateBasis: {
              sourceType: 'published_schedule', acquisitionMode: 'not_applicable',
              location: 'Durban', effectiveDate: '2026-07-16', vatTreatment: 'exclusive',
            },
            assumptionStatus: 'unverified',
          }],
          directCost: '100',
          conditions: [],
          riskNotes: [],
        },
      ],
      resourceSummary: [],
      assumptions: [],
    } as never);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.totalQuantity).toBe('30');
    expect(data.rows[0]?.assumptionStatus).toBe('unverified');
    expect(data.rows[0]?.sourceBoqItemIds).toEqual(['item-1', 'item-2']);
    expect(data.rows[0]?.unitRate).toBe('50');
  });

  test('writes markdown/json artifacts from a pricing pack', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-resource-schedule-'));
    const projectDirectory = join(root, 'business');
    const projectRoot = join(root, 'project');
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    const pricingPackPath = join(projectDirectory, 'packs', 'boq-five-step-pricing.json');
    writeFileSync(pricingPackPath, JSON.stringify({
      schemaVersion: 1,
      capability: 'boq_five_step_pricing',
      projectId: 'n3',
      revision: 1,
      coreRevision: 1,
      upstream: [],
      updatedAt: '2026-07-16T00:00:00.000Z',
      data: {
        currency: 'ZAR',
        itemBuildUps: [{
          boqItemId: 'item-1',
          status: 'reviewed',
          itemIdentity: { code: '5.1.1', description: 'A', unit: 'm', quantity: '3', sourceRef: { documentId: 'boq' } },
          resourceConsumptions: [{
            id: 'c1', kind: 'material', description: 'Diesel', quantity: '4', unit: 'L/m',
            assumptionStatus: 'sourced', quantityBasis: 'per_boq_unit', calculationBasis: '4L',
            costComponentId: 'diesel', sourceRefs: [],
          }],
          costComponents: [{
            id: 'diesel', kind: 'material', description: 'Diesel', quantity: '4', unit: 'L/m',
            rate: '23.5', amount: '94', rateSourceRef: { documentId: 'quote' },
            rateBasis: {
              sourceType: 'quote', acquisitionMode: 'web_search',
              location: 'Durban', effectiveDate: '2026-07-16', vatTreatment: 'exclusive',
            },
            assumptionStatus: 'sourced',
          }],
          directCost: '94',
          conditions: [],
          riskNotes: [],
          steps: {
            scopeQuantity: { narrative: 'n', sourceRefs: [] },
            methodProductivity: { narrative: 'n', sourceRefs: [] },
            resourceConsumption: { narrative: 'n', sourceRefs: [] },
            sourcedRatesDirectCost: { narrative: 'n', sourceRefs: [] },
            reconciliationRisk: { narrative: 'n', sourceRefs: [] },
          },
        }],
        resourceSummary: [],
        assumptions: [],
      },
    }));

    const result = writeConstructionResourceScheduleArtifacts({
      projectRoot,
      projectId: 'n3',
      pricingPackPath,
    });
    expect('errors' in result).toBe(false);
    if ('errors' in result) return;
    expect(result.data.rows[0]?.totalQuantity).toBe('12');
    expect(existsSync(result.markdownPath)).toBe(true);
    expect(readFileSync(result.markdownPath, 'utf8')).toContain('施工资源消耗总表');
  });
});
