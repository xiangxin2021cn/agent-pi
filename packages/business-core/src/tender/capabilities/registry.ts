import type {
  TenderCapabilityDependency,
  TenderCapabilityEnvelope,
  TenderCapabilityId,
} from './types.ts';

const STATIC_DEPENDENCIES: Record<Exclude<TenderCapabilityId, 'submission_audit'>, TenderCapabilityDependency[]> = {
  evaluation_strategy: ['core'],
  boq_reconciliation: ['core'],
  execution_plan: ['core', 'evaluation_strategy', 'boq_reconciliation'],
  schedule_resources: ['core', 'execution_plan'],
  cost_cashflow: ['core', 'boq_reconciliation', 'schedule_resources'],
};

export function getTenderCapabilityDependencies(
  capability: TenderCapabilityId,
  enabledCapabilities: TenderCapabilityId[] = [],
): TenderCapabilityDependency[] {
  if (capability !== 'submission_audit') return [...STATIC_DEPENDENCIES[capability]];
  return [
    'core',
    ...enabledCapabilities.filter((candidate) => candidate !== 'submission_audit'),
  ];
}

export function isTenderCapabilityStale(
  envelope: TenderCapabilityEnvelope,
  currentCoreRevision: number,
  capabilityRevisions: Partial<Record<TenderCapabilityId, number>>,
): boolean {
  if (envelope.coreRevision !== currentCoreRevision) return true;

  return envelope.upstream.some((reference) => {
    if (reference.capability === 'core') return reference.revision !== currentCoreRevision;
    return capabilityRevisions[reference.capability] !== reference.revision;
  });
}
