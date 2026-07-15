import { z } from 'zod';
import { TenderSourceLocatorSchema } from '../../schema.ts';
import type { TenderBoqFiveStepPricingData } from './types.ts';

const EntityIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i, 'Entity ID must be filesystem-safe.');
const NonEmptyString = z.string().trim().min(1);
const DecimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Expected a non-negative unformatted decimal string.');
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO currency code.');
const ResourceKindSchema = z.enum(['labour', 'plant', 'material', 'subcontract', 'transport', 'waste', 'other']);

const TenderBoqPricingStepSchema = z.object({
  narrative: z.string(),
  sourceRefs: z.array(TenderSourceLocatorSchema).default([]),
}).strict();

const TenderBoqFiveStepRecordSchema = z.object({
  scopeQuantity: TenderBoqPricingStepSchema,
  methodProductivity: TenderBoqPricingStepSchema,
  resourceConsumption: TenderBoqPricingStepSchema,
  sourcedRatesDirectCost: TenderBoqPricingStepSchema,
  reconciliationRisk: TenderBoqPricingStepSchema,
}).strict();

const TenderBoqResourceConsumptionSchema = z.object({
  id: EntityIdSchema,
  kind: ResourceKindSchema,
  description: NonEmptyString,
  quantity: DecimalString,
  unit: NonEmptyString,
  assumptionStatus: z.enum(['sourced', 'scenario', 'unverified']),
}).strict();

const TenderBoqPricingCostComponentSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(['labour', 'plant', 'material', 'subcontract', 'transport', 'waste', 'overhead', 'contingency', 'escalation', 'other']),
  description: NonEmptyString,
  quantity: DecimalString,
  unit: NonEmptyString,
  rate: DecimalString,
  amount: DecimalString,
  rateSourceRef: TenderSourceLocatorSchema.optional(),
  assumptionStatus: z.enum(['sourced', 'scenario', 'unverified']),
}).strict();

const TenderBoqFiveStepItemBuildUpSchema = z.object({
  boqItemId: EntityIdSchema,
  status: z.enum(['draft', 'reviewed', 'blocked']),
  steps: TenderBoqFiveStepRecordSchema,
  resourceConsumptions: z.array(TenderBoqResourceConsumptionSchema).default([]),
  costComponents: z.array(TenderBoqPricingCostComponentSchema).default([]),
  directCost: DecimalString,
  conditions: z.array(NonEmptyString).default([]),
  riskNotes: z.array(NonEmptyString).default([]),
}).strict();

const TenderBoqPricingResourceSummarySchema = z.object({
  kind: ResourceKindSchema,
  description: NonEmptyString,
  quantity: DecimalString,
  unit: NonEmptyString,
}).strict();

const TenderBoqPricingAssumptionSchema = z.object({
  id: EntityIdSchema,
  text: NonEmptyString,
  status: z.enum(['scenario', 'unverified', 'confirmed', 'rejected']),
  sourceRefs: z.array(TenderSourceLocatorSchema).default([]),
}).strict();

export const TenderBoqFiveStepPricingDataSchema = z.object({
  currency: CurrencySchema,
  pricingStatus: z.enum(['draft', 'reviewed', 'blocked']),
  itemBuildUps: uniqueBy(TenderBoqFiveStepItemBuildUpSchema, 'boqItemId'),
  resourceSummary: z.array(TenderBoqPricingResourceSummarySchema).default([]),
  assumptions: uniqueBy(TenderBoqPricingAssumptionSchema, 'id'),
}).strict();

export function parseTenderBoqFiveStepPricingData(value: unknown): TenderBoqFiveStepPricingData {
  return TenderBoqFiveStepPricingDataSchema.parse(value) as TenderBoqFiveStepPricingData;
}

function uniqueBy<T extends z.ZodType<Record<K, string>>, K extends string>(schema: T, key: K) {
  return z.array(schema).superRefine((records, context) => {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      if (seen.has(record[key])) {
        context.addIssue({ code: 'custom', path: [index, key], message: `Duplicate ${key}: ${record[key]}` });
      }
      seen.add(record[key]);
    });
  });
}
