import type { TenderSourceLocator } from '../../types.ts';
import type { TenderCapabilityAuditIssue, TenderCapabilityReadiness } from '../types.ts';

export type TenderBoqPricingResourceKind =
  | 'labour'
  | 'plant'
  | 'material'
  | 'subcontract'
  | 'transport'
  | 'waste'
  | 'other';

export interface TenderBoqPricingStep {
  narrative: string;
  sourceRefs: TenderSourceLocator[];
}

export interface TenderBoqFiveStepRecord {
  scopeQuantity: TenderBoqPricingStep;
  methodProductivity: TenderBoqPricingStep;
  resourceConsumption: TenderBoqPricingStep;
  sourcedRatesDirectCost: TenderBoqPricingStep;
  reconciliationRisk: TenderBoqPricingStep;
}

export interface TenderBoqResourceConsumption {
  id: string;
  kind: TenderBoqPricingResourceKind;
  description: string;
  quantity: string;
  unit: string;
  assumptionStatus: 'sourced' | 'scenario' | 'unverified';
}

export interface TenderBoqPricingCostComponent {
  id: string;
  kind: TenderBoqPricingResourceKind | 'overhead' | 'contingency' | 'escalation' | 'other';
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
  rateSourceRef?: TenderSourceLocator;
  assumptionStatus: 'sourced' | 'scenario' | 'unverified';
}

export interface TenderBoqPlanningBasis {
  methodId: string;
  productionRate: string;
  quantityUnit: string;
  timeUnit: 'hour' | 'shift' | 'working_day' | 'week';
  duration: string;
  calendarId: string;
  activityId: string;
  assumptionStatus: 'sourced' | 'scenario' | 'unverified';
  sourceRefs: TenderSourceLocator[];
}

export interface TenderBoqInitialCashFlowAllocation {
  period: string;
  activityId: string;
  weight: string;
  amount: string;
  basis: string;
  assumptionStatus: 'sourced' | 'scenario' | 'unverified';
  sourceRefs: TenderSourceLocator[];
}

export interface TenderBoqFiveStepItemBuildUp {
  boqItemId: string;
  status: 'draft' | 'reviewed' | 'blocked';
  steps: TenderBoqFiveStepRecord;
  resourceConsumptions: TenderBoqResourceConsumption[];
  planningBasis?: TenderBoqPlanningBasis;
  initialCashFlow?: TenderBoqInitialCashFlowAllocation[];
  costComponents: TenderBoqPricingCostComponent[];
  directCost: string;
  conditions: string[];
  riskNotes: string[];
}

export interface TenderBoqPricingResourceSummary {
  kind: TenderBoqPricingResourceKind;
  description: string;
  quantity: string;
  unit: string;
}

export interface TenderBoqPricingAssumption {
  id: string;
  text: string;
  status: 'scenario' | 'unverified' | 'confirmed' | 'rejected';
  sourceRefs: TenderSourceLocator[];
}

export interface TenderBoqFiveStepPricingData {
  currency: string;
  pricingStatus: 'draft' | 'reviewed' | 'blocked';
  itemBuildUps: TenderBoqFiveStepItemBuildUp[];
  resourceSummary: TenderBoqPricingResourceSummary[];
  assumptions: TenderBoqPricingAssumption[];
}

export interface TenderBoqFiveStepPricingAudit {
  schemaVersion: 1;
  capability: 'boq_five_step_pricing';
  projectId: string;
  coreRevision: number;
  generatedAt: string;
  readiness: TenderCapabilityReadiness;
  summary: {
    items: number;
    completeItems: number;
    blockedItems: number;
    unverifiedComponents: number;
    estimatedDirectCost: string;
  };
  issues: TenderCapabilityAuditIssue[];
}
