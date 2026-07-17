import { describe, expect, test } from 'bun:test';
import type { TenderWorkspace } from '../../types.ts';
import type { TenderBoqReconciliationData } from '../boq/types.ts';
import { auditTenderBoqFiveStepPricing } from './audit.ts';
import type { TenderBoqFiveStepPricingData } from './types.ts';

const workspace: TenderWorkspace = {
  schemaVersion: 1,
  revision: 3,
  project: {
    id: 'n3',
    title: 'N3 Tender',
    currency: 'ZAR',
    status: 'active',
  },
  documents: [
    { id: 'boq', name: 'BOQ', path: 'C:/tender/boq.xlsx', kind: 'boq', status: 'active' },
    { id: 'spec', name: 'Specification', path: 'C:/tender/spec.pdf', kind: 'specification', status: 'active' },
    { id: 'quote', name: 'Rate Evidence', path: 'C:/tender/quote.pdf', kind: 'supporting_evidence', status: 'active' },
  ],
  requirements: [],
  criteria: [],
  deliverables: [],
  responses: [],
};

const boqData: TenderBoqReconciliationData = {
  items: [{
    id: 'b6100-1',
    source: { documentId: 'boq', sheet: 'B6100', cell: 'A12:F12' },
    code: '1/61.02(a)(i)',
    description: 'Excavate 0-2m',
    unit: 'm3',
    quantity: '100',
    quantityBasis: 'boq',
    quantityStatus: 'sourced',
    quantityRefs: [],
  }],
  scopeLinks: [{
    boqItemId: 'b6100-1',
    requirementIds: [],
    specificationRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
    drawingRefs: [],
    measurementRuleRefs: [{ documentId: 'spec', clause: '6108', page: 31 }],
    inclusions: ['Excavation and trimming'],
    exclusions: [],
    assumptions: [],
    gapStatus: 'clear',
  }],
};

const completePricing: TenderBoqFiveStepPricingData = {
  currency: 'ZAR',
  pricingStatus: 'reviewed',
  itemBuildUps: [{
    boqItemId: 'b6100-1',
    status: 'reviewed',
    steps: {
      scopeQuantity: {
        narrative: 'BOQ quantity 100 m3 is sourced from B6100 row 12 and scoped by specification clause 6102.',
        sourceRefs: [{ documentId: 'boq', sheet: 'B6100', cell: 'A12:F12' }],
      },
      methodProductivity: {
        narrative: 'Excavate by small plant with trimming crew using measured cycle output.',
        sourceRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
      },
      resourceConsumption: {
        narrative: 'Crew and plant consumption is calculated per m3 from the stated productivity basis.',
        sourceRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
      },
      sourcedRatesDirectCost: {
        narrative: 'Direct cost uses source-traced plant and labour rates.',
        sourceRefs: [{ documentId: 'quote', page: 1 }],
      },
      reconciliationRisk: {
        narrative: 'Rate reconciles to the BOQ unit and flags no unresolved exclusions.',
        sourceRefs: [{ documentId: 'spec', clause: '6108', page: 31 }],
      },
    },
    resourceConsumptions: [
      { id: 'res-labour', kind: 'labour', description: 'Excavation crew', quantity: '2', unit: 'h/m3', assumptionStatus: 'sourced' },
      { id: 'res-plant', kind: 'plant', description: 'Excavator', quantity: '0.5', unit: 'h/m3', assumptionStatus: 'sourced' },
    ],
    planningBasis: {
      methodId: 'small-plant-excavation',
      productionRate: '10',
      quantityUnit: 'm3',
      timeUnit: 'working_day',
      duration: '10',
      calendarId: 'calendar-standard',
      activityId: 'activity-b6100-1',
      assumptionStatus: 'sourced',
      sourceRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
    },
    initialCashFlow: [
      {
        period: '2026-08',
        activityId: 'activity-b6100-1',
        weight: '0.6',
        amount: '300',
        basis: 'Mobilisation and first production period.',
        assumptionStatus: 'sourced',
        sourceRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
      },
      {
        period: '2026-09',
        activityId: 'activity-b6100-1',
        weight: '0.4',
        amount: '200',
        basis: 'Remaining production period.',
        assumptionStatus: 'sourced',
        sourceRefs: [{ documentId: 'spec', clause: '6102', page: 23 }],
      },
    ],
    costComponents: [
      { id: 'cost-labour', kind: 'labour', description: 'Excavation crew', quantity: '2', unit: 'h', rate: '100', amount: '200', rateSourceRef: { documentId: 'quote', page: 1 }, assumptionStatus: 'sourced' },
      { id: 'cost-plant', kind: 'plant', description: 'Excavator', quantity: '0.5', unit: 'h', rate: '600', amount: '300', rateSourceRef: { documentId: 'quote', page: 1 }, assumptionStatus: 'sourced' },
    ],
    directCost: '500',
    conditions: [],
    riskNotes: [],
  }],
  resourceSummary: [
    { kind: 'labour', description: 'Excavation crew', quantity: '200', unit: 'h' },
    { kind: 'plant', description: 'Excavator', quantity: '50', unit: 'h' },
  ],
  assumptions: [],
};

describe('tender BOQ five-step pricing audit', () => {
  test('passes only when every BOQ item has all five pricing steps and reconciled cost', () => {
    const audit = auditTenderBoqFiveStepPricing(workspace, boqData, completePricing, '2026-07-15T00:00:00.000Z');

    expect(audit.readiness).toBe('ready');
    expect(audit.summary.items).toBe(1);
    expect(audit.summary.completeItems).toBe(1);
    expect(audit.summary.estimatedDirectCost).toBe('500');
  });

  test('rejects missing item build-ups and incomplete five-step derivations', () => {
    const missing = auditTenderBoqFiveStepPricing(workspace, boqData, {
      ...completePricing,
      itemBuildUps: [],
    }, '2026-07-15T00:00:00.000Z');
    const incomplete = auditTenderBoqFiveStepPricing(workspace, boqData, {
      ...completePricing,
      itemBuildUps: [{
        ...completePricing.itemBuildUps[0]!,
        steps: {
          ...completePricing.itemBuildUps[0]!.steps,
          methodProductivity: { narrative: '', sourceRefs: [] },
        },
      }],
    }, '2026-07-15T00:00:00.000Z');

    expect(missing.readiness).toBe('not_ready');
    expect(missing.issues.map((issue) => issue.code)).toContain('boq_pricing_build_up_missing');
    expect(incomplete.readiness).toBe('not_ready');
    expect(incomplete.issues.map((issue) => issue.code)).toContain('boq_pricing_step_incomplete');
  });

  test('rejects a reviewed item without a calculable planning or initial cash-flow basis', () => {
    const item = completePricing.itemBuildUps[0]!;
    const audit = auditTenderBoqFiveStepPricing(workspace, boqData, {
      ...completePricing,
      itemBuildUps: [{ ...item, planningBasis: undefined, initialCashFlow: [] }],
    }, '2026-07-15T00:00:00.000Z');

    expect(audit.readiness).toBe('not_ready');
    expect(audit.issues.map((issue) => issue.code)).toContain('boq_pricing_planning_basis_missing');
    expect(audit.issues.map((issue) => issue.code)).toContain('boq_pricing_cash_flow_missing');
  });

  test('rejects duration capacity that cannot produce the BOQ quantity', () => {
    const item = completePricing.itemBuildUps[0]!;
    const audit = auditTenderBoqFiveStepPricing(workspace, boqData, {
      ...completePricing,
      itemBuildUps: [{
        ...item,
        planningBasis: { ...item.planningBasis!, duration: '2' },
      }],
    }, '2026-07-15T00:00:00.000Z');

    expect(audit.readiness).toBe('not_ready');
    expect(audit.issues.map((issue) => issue.code)).toContain('boq_pricing_duration_capacity_shortfall');
  });

  test('rejects initial cash-flow weights and amounts that do not reconcile', () => {
    const item = completePricing.itemBuildUps[0]!;
    const audit = auditTenderBoqFiveStepPricing(workspace, boqData, {
      ...completePricing,
      itemBuildUps: [{
        ...item,
        initialCashFlow: item.initialCashFlow!.map((allocation, index) => index === 0
          ? { ...allocation, weight: '0.5', amount: '250' }
          : allocation),
      }],
    }, '2026-07-15T00:00:00.000Z');

    const issueCodes = audit.issues.map((issue) => issue.code);
    expect(audit.readiness).toBe('not_ready');
    expect(issueCodes).toContain('boq_pricing_cash_flow_weight_mismatch');
    expect(issueCodes).toContain('boq_pricing_cash_flow_amount_mismatch');
  });
});
