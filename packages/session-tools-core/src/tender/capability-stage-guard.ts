import type { TenderCapabilityId } from '@agent-pi/business-core/tender';

const STAGE_ALIASES: Record<string, string> = {
  planning: 'planning-and-submission',
  submission: 'planning-and-submission',
  'work-plan-methodology': 'planning-and-submission',
  'schedule-resource-planning': 'planning-and-submission',
  'cost-cashflow-planning': 'planning-and-submission',
  'tender-submission-documents': 'planning-and-submission',
  'submission-audit': 'planning-and-submission',
  'bidder-commitments': 'boq-five-step-pricing',
};

const STAGE_WRITE_ALLOWLIST: Record<string, readonly TenderCapabilityId[]> = {
  'project-setup': [],
  'tender-document-analysis': ['document_analysis', 'boq_reconciliation', 'evaluation_strategy'],
  'project-boundary-conditions': ['project_boundary'],
  'boq-five-step-pricing': [
    'boq_five_step_pricing',
    'construction_resource_schedule',
    'bidder_commitments',
  ],
  'planning-and-submission': [
    'execution_plan',
    'schedule_resources',
    'cost_cashflow',
    'submission_documents',
    'submission_audit',
  ],
};

export function canonicalTenderStageId(stageId: string): string {
  return STAGE_ALIASES[stageId] ?? stageId;
}

export function allowedCapabilitiesForStage(stageId: string): readonly TenderCapabilityId[] | undefined {
  return STAGE_WRITE_ALLOWLIST[canonicalTenderStageId(stageId)];
}

/**
 * Reject capability pack writes that skip ahead of the session's business stage.
 * No-op when stageId is absent (non-tender sessions / runtime merge contexts).
 */
export function assertCapabilityWriteAllowed(
  stageId: string | undefined,
  capability: TenderCapabilityId,
): void {
  if (!stageId?.trim()) return;
  const allowed = allowedCapabilitiesForStage(stageId);
  if (allowed === undefined) {
    throw new Error(
      `Tender capability ${capability} cannot be written: unknown business stage "${stageId}".`,
    );
  }
  if (!allowed.includes(capability)) {
    throw new Error(
      `Tender capability ${capability} is not allowed during stage "${canonicalTenderStageId(stageId)}".`,
    );
  }
}
