import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  tenderOfficialOutputOwnerId,
  tenderOfficialOutputsDir,
} from './tender-official-outputs.ts';

export type PlanningSubstepId =
  | 'plan-methodology'
  | 'plan-programme-resources-cashflow'
  | 'plan-submission';

export type PlanningSubstepStatus = 'pending' | 'ready' | 'complete' | 'blocked';

export interface PlanningSubstepState {
  id: PlanningSubstepId;
  label: string;
  status: PlanningSubstepStatus;
  missingItems: string[];
}

export type PlanningArtifactReview = 'pending' | 'accepted' | 'rejected';

export interface TenderPlanningReviewLedger {
  schemaVersion: 1;
  projectId: string;
  methodologyReport: {
    artifactPath: string;
    humanReview: PlanningArtifactReview;
    updatedAt: string;
    notes?: string;
  };
}

const SUBSTEPS: Array<{ id: PlanningSubstepId; label: string }> = [
  { id: 'plan-methodology', label: '4-A 施工策划' },
  { id: 'plan-programme-resources-cashflow', label: '4-B 进度·资源·现金流' },
  { id: 'plan-submission', label: '4-C 正式出稿与核对' },
];

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}

export function planningOutputDirectory(projectRoot: string, officialOwnerId: string): string {
  return tenderOfficialOutputsDir(projectRoot, officialOwnerId, 'planning');
}

export function planningMethodologyReportPath(
  projectRoot: string,
  officialOwnerId: string,
): string {
  return join(planningOutputDirectory(projectRoot, officialOwnerId), '施工策划报告.md');
}

export function planningReviewLedgerPath(projectDirectory: string): string {
  return join(projectDirectory, 'orchestration', 'planning-review.json');
}

export function readPlanningReviewLedger(
  projectDirectory: string,
  projectId: string,
  projectRoot: string,
  parentSessionId?: string,
): TenderPlanningReviewLedger {
  const artifactPath = planningMethodologyReportPath(
    projectRoot,
    tenderOfficialOutputOwnerId(parentSessionId, projectId),
  );
  const path = planningReviewLedgerPath(projectDirectory);
  if (!existsSync(path)) {
    return {
      schemaVersion: 1,
      projectId,
      methodologyReport: {
        artifactPath,
        humanReview: 'pending',
        updatedAt: new Date(0).toISOString(),
      },
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TenderPlanningReviewLedger;
    if (parsed.schemaVersion !== 1 || !parsed.methodologyReport) {
      return {
        schemaVersion: 1,
        projectId,
        methodologyReport: {
          artifactPath,
          humanReview: 'pending',
          updatedAt: new Date(0).toISOString(),
        },
      };
    }
    return {
      ...parsed,
      projectId,
      methodologyReport: {
        ...parsed.methodologyReport,
        artifactPath,
      },
    };
  } catch {
    return {
      schemaVersion: 1,
      projectId,
      methodologyReport: {
        artifactPath,
        humanReview: 'pending',
        updatedAt: new Date(0).toISOString(),
      },
    };
  }
}

export function markPlanningMethodologyReview(options: {
  projectDirectory: string;
  projectId: string;
  projectRoot: string;
  humanReview: 'accepted' | 'rejected';
  notes?: string;
  parentSessionId?: string;
}): TenderPlanningReviewLedger {
  const artifactPath = planningMethodologyReportPath(
    options.projectRoot,
    tenderOfficialOutputOwnerId(options.parentSessionId, options.projectId),
  );
  const ledger: TenderPlanningReviewLedger = {
    schemaVersion: 1,
    projectId: options.projectId,
    methodologyReport: {
      artifactPath,
      humanReview: options.humanReview,
      updatedAt: new Date().toISOString(),
      ...(options.notes ? { notes: options.notes } : {}),
    },
  };
  atomicWriteJson(planningReviewLedgerPath(options.projectDirectory), ledger);
  return ledger;
}

/**
 * Heuristic XML probe (documented):
 * - file exists, non-empty, trim-starts with `<`
 * - MSP: contains `<Project` (Microsoft Project namespace often present)
 * - P6: contains `APIBusinessObjects` (Primavera BusinessObjects root)
 */
export function probeProgrammeXml(filePath: string, kind: 'msp' | 'p6'): string[] {
  if (!existsSync(filePath)) return [`missing:${kind}-xml`];
  try {
    const text = readFileSync(filePath, 'utf8');
    if (!text.trim()) return [`empty:${kind}-xml`];
    if (!text.trimStart().startsWith('<')) return [`not-xml:${kind}-xml`];
    if (kind === 'msp' && !/<Project[\s>]/i.test(text) && !/schemas\.microsoft\.com\/project/i.test(text)) {
      return [`invalid-root:${kind}-xml`];
    }
    if (kind === 'p6' && !/APIBusinessObjects/i.test(text)) {
      return [`invalid-root:${kind}-xml`];
    }
    return [];
  } catch (error) {
    return [`unreadable:${kind}-xml:${error instanceof Error ? error.message : String(error)}`];
  }
}

function probeMethodology(
  projectRoot: string,
  _projectDirectory: string,
  projectId: string,
  parentSessionId?: string,
): string[] {
  const mdPath = planningMethodologyReportPath(
    projectRoot,
    tenderOfficialOutputOwnerId(parentSessionId, projectId),
  );
  return existsSync(mdPath) ? [] : ['missing:methodology-md'];
}

function probeProgrammeResourcesCashflow(
  projectRoot: string,
  projectId: string,
  parentSessionId?: string,
): string[] {
  const directory = planningOutputDirectory(
    projectRoot,
    tenderOfficialOutputOwnerId(parentSessionId, projectId),
  );
  const mspOk = probeProgrammeXml(join(directory, 'tender-programme.msp.xml'), 'msp').length === 0;
  const p6Ok = probeProgrammeXml(join(directory, 'tender-programme.p6.xml'), 'p6').length === 0;
  const plantOk = existsSync(join(directory, 'plant-histogram.html'));
  const labourOk = existsSync(join(directory, 'labour-histogram.html'));
  const sCurveOk = existsSync(join(directory, 'S-Curve_Cash_Flow_Chart.html'));
  const missing: string[] = [];
  if (!mspOk && !p6Ok) missing.push('missing:programme-xml');
  if (!plantOk && !labourOk && !sCurveOk) missing.push('missing:resource-or-cashflow-artifact');
  return missing;
}

function probeSubmission(
  projectRoot: string,
  projectId: string,
  parentSessionId?: string,
): string[] {
  const directory = planningOutputDirectory(
    projectRoot,
    tenderOfficialOutputOwnerId(parentSessionId, projectId),
  );
  const docxOk = existsSync(join(directory, 'Work_Plan_and_Proposed_Methodology.docx'));
  const auditOk = existsSync(join(directory, 'submission_audit.md'));
  if (docxOk || auditOk) return [];
  return ['missing:submission-artifact'];
}

function classifySubstepStatus(
  missingItems: string[],
  priorComplete: boolean,
): PlanningSubstepStatus {
  if (!priorComplete) return 'pending';
  if (missingItems.length === 0) return 'complete';
  // Soft: methodology-review leftovers no longer apply; treat advisory review as ready.
  if (missingItems.every((item) => item.startsWith('methodology-review:'))) return 'ready';
  return 'blocked';
}

export function evaluatePlanningSubsteps(
  projectRoot: string,
  projectDirectory: string,
  projectId: string,
  parentSessionId?: string,
): PlanningSubstepState[] {
  const probes: Record<PlanningSubstepId, string[]> = {
    'plan-methodology': probeMethodology(projectRoot, projectDirectory, projectId, parentSessionId),
    'plan-programme-resources-cashflow': probeProgrammeResourcesCashflow(projectRoot, projectId, parentSessionId),
    'plan-submission': probeSubmission(projectRoot, projectId, parentSessionId),
  };

  let priorComplete = true;
  return SUBSTEPS.map((substep) => {
    const missingItems = probes[substep.id];
    const status = classifySubstepStatus(missingItems, priorComplete);
    if (status === 'complete') priorComplete = true;
    else priorComplete = false;
    return {
      id: substep.id,
      label: substep.label,
      status,
      missingItems,
    };
  });
}

export function assertPlanningSubstepGate(
  projectRoot: string,
  projectDirectory: string,
  projectId: string,
  parentSessionId?: string,
): string[] {
  return evaluatePlanningSubsteps(projectRoot, projectDirectory, projectId, parentSessionId)
    .flatMap((substep) => substep.missingItems.map((item) => `planning-substep:${substep.id}:${item}`));
}
