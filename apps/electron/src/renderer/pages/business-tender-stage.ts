import { i18n } from '@craft-agent/shared/i18n'
import type {
  TenderStageRunRequest,
  TenderStageRunResultDto,
} from '@craft-agent/shared/protocol'

type RunTenderStage = (request: TenderStageRunRequest) => Promise<TenderStageRunResultDto>

export async function preflightTenderStageLaunch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action'>,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const preflight = await run({ ...target, action: 'preflight' })
  return { ok: preflight.status !== 'blocked', result: preflight }
}

export async function startTenderStageLaunch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'parentSessionId'>,
  parentSessionId: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const started = await run({ ...target, action: 'start', parentSessionId })
  return { ok: started.status === 'running' || started.status === 'complete', result: started }
}

/** Bind parent + start, then advance once to fill concurrency slots (no flood on start alone). */
export async function startAndAdvanceTenderStageLaunch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'parentSessionId'>,
  parentSessionId: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const started = await startTenderStageLaunch(run, target, parentSessionId)
  if (!started.ok || !started.result.batchProgress) return started
  const advanced = await run({ ...target, action: 'advance', parentSessionId })
  return { ok: advanced.status === 'running' || advanced.status === 'complete', result: advanced }
}

/** Reconcile idle slots and dispatch pending batches without resetting failed tasks. */
export async function resumeTenderStageLaunch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'parentSessionId'>,
  parentSessionId?: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const resumed = await run({
    ...target,
    action: 'resume',
    ...(parentSessionId ? { parentSessionId } : {}),
  })
  return { ok: resumed.status === 'running' || resumed.status === 'complete', result: resumed }
}

export async function advanceTenderStageLaunch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'parentSessionId'>,
  parentSessionId?: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const advanced = await run({
    ...target,
    action: 'advance',
    ...(parentSessionId ? { parentSessionId } : {}),
  })
  return { ok: advanced.status === 'running' || advanced.status === 'complete', result: advanced }
}

export async function setTenderStageDispatch(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'dispatchEnabled'>,
  dispatchEnabled: boolean,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const result = await run({ ...target, action: 'set_dispatch', dispatchEnabled })
  return { ok: true, result }
}

export async function resetTenderStageOrchestration(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action'>,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const result = await run({ ...target, action: 'reset_orchestration' })
  return { ok: true, result }
}

export async function forcePassTenderStage(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action'>,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const result = await run({ ...target, action: 'force_pass' })
  return { ok: result.status !== 'blocked', result }
}

export async function acceptPlanningMethodologyReview(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'planningReview'>,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  const result = await run({
    ...target,
    action: 'status',
    stageId: 'planning-and-submission',
    planningReview: { artifact: 'methodology_report', humanReview: 'accepted' },
  })
  return { ok: true, result }
}

export function resolveStageParentSessionId(run?: TenderStageRunResultDto): string | undefined {
  return run?.projectParentSessionId ?? run?.batchProgress?.parentSessionId
}

/** Prefer the project-lifetime parent across any stage snapshot. */
export function resolveProjectParentSessionId(
  stageRuns: Record<string, TenderStageRunResultDto | undefined>,
): string | undefined {
  for (const run of Object.values(stageRuns)) {
    if (run?.projectParentSessionId) return run.projectParentSessionId
  }
  for (const run of Object.values(stageRuns)) {
    const id = run?.batchProgress?.parentSessionId
    if (id) return id
  }
  return undefined
}

export function shouldOpenNewParentSession(run?: TenderStageRunResultDto): boolean {
  return !resolveStageParentSessionId(run)
}

export function shouldOpenNewProjectParentSession(
  stageRuns: Record<string, TenderStageRunResultDto | undefined>,
): boolean {
  return !resolveProjectParentSessionId(stageRuns)
}

/** Enter/advance a stage on the existing project parent (mutates stageId server-side). */
export async function enterTenderStageInProjectParent(
  run: RunTenderStage,
  target: Omit<TenderStageRunRequest, 'action' | 'parentSessionId'>,
  parentSessionId: string,
): Promise<{ ok: boolean; result: TenderStageRunResultDto }> {
  return startAndAdvanceTenderStageLaunch(run, target, parentSessionId)
}

const PLANNING_SUBSTEP_KEYS: Record<string, string> = {
  'plan-methodology': 'businessProjects.substepPlanMethodology',
  'plan-programme-resources-cashflow': 'businessProjects.substepPlanProgramme',
  'plan-submission': 'businessProjects.substepPlanSubmission',
}

export function planningSubstepLabel(substepId: string): string {
  const key = PLANNING_SUBSTEP_KEYS[substepId]
  return key ? i18n.t(key) : substepId
}

export function summarizeTenderStage(result: TenderStageRunResultDto): {
  statusLabel: string
  upstreamLabel?: string
  sourceLabel: string
  batchLabel?: string
  missingLabel?: string
  packsLabel?: string
} {
  const statusLabel = {
    blocked: i18n.t('businessProjects.statusBlocked'),
    ready: i18n.t('businessProjects.statusReady'),
    running: i18n.t('businessProjects.statusRunning'),
    complete: i18n.t('businessProjects.statusComplete'),
  }[result.status]
  const readyUpstreamCount = result.requiredCapabilities
    .filter((capability) => result.generatedPacks.includes(capability)).length
  const upstreamLabel = result.requiredCapabilities.length > 0
    ? i18n.t('businessProjects.summaryUpstream', {
      ready: readyUpstreamCount,
      total: result.requiredCapabilities.length,
    })
    : undefined
  const sourceLabel = i18n.t('businessProjects.summarySources', {
    count: result.sourceBoundary.registeredCount,
  })
  const batchUnit = result.batchProgress?.batchType === 'document_analysis'
    ? i18n.t('businessProjects.summaryUnitDocs')
    : i18n.t('businessProjects.summaryUnitItems')
  const batchLabel = result.batchProgress
    ? [
        i18n.t('businessProjects.summaryBatches', {
          completed: result.batchProgress.completedBatches,
          total: result.batchProgress.batchCount,
        }),
        result.batchProgress.runningBatches > 0
          ? i18n.t('businessProjects.summaryRunningCount', { count: result.batchProgress.runningBatches })
          : undefined,
        result.batchProgress.pendingBatches > 0
          ? i18n.t('businessProjects.summaryPendingCount', { count: result.batchProgress.pendingBatches })
          : undefined,
        result.batchProgress.failedBatches > 0
          ? i18n.t('businessProjects.summaryFailedCount', { count: result.batchProgress.failedBatches })
          : undefined,
        result.batchProgress.blockedBatches > 0
          ? i18n.t('businessProjects.summaryBlockedCount', { count: result.batchProgress.blockedBatches })
          : undefined,
        i18n.t('businessProjects.summaryRemaining', {
          count: result.batchProgress.missingItemCount,
          unit: batchUnit,
        }),
      ].filter(Boolean).join(' · ')
    : undefined
  const missingLabel = result.missingItems.length > 0
    ? result.missingItems.map(formatTenderMissingItem).join(i18n.t('businessProjects.missingJoin'))
    : undefined
  const packsLabel = result.generatedPacks.length > 0
    ? i18n.t('businessProjects.summaryPacks', { packs: result.generatedPacks.join(', ') })
    : undefined
  return { statusLabel, upstreamLabel, sourceLabel, batchLabel, missingLabel, packsLabel }
}

export function formatTenderMissingItem(item: string): string {
  if (item === 'document-batches:incomplete') return i18n.t('businessProjects.missingDocumentIncomplete')
  if (item === 'document-batches:no-documents') return i18n.t('businessProjects.missingDocumentNoDocs')
  if (item === 'document-batches:manifest-unavailable') return i18n.t('businessProjects.missingDocumentManifest')
  if (item.startsWith('document-merge:')) {
    return i18n.t('businessProjects.missingDocumentMerge', { detail: item.slice('document-merge:'.length) })
  }
  if (item.startsWith('document-review:missing-md:')) {
    return i18n.t('businessProjects.missingDocumentReviewMd', {
      detail: item.slice('document-review:missing-md:'.length),
    })
  }
  if (item.startsWith('document-review:pending:')) {
    return i18n.t('businessProjects.missingDocumentReviewPending', {
      detail: item.slice('document-review:pending:'.length),
    })
  }
  if (item.startsWith('document-review:')) {
    return i18n.t('businessProjects.missingDocumentReview', { detail: item.slice('document-review:'.length) })
  }
  if (item === 'boq-batches:incomplete') return i18n.t('businessProjects.missingBoqIncomplete')
  if (item === 'boq-batches:no-items') return i18n.t('businessProjects.missingBoqNoItems')
  if (item === 'boq-batches:manifest-unavailable') return i18n.t('businessProjects.missingBoqManifest')
  if (item.startsWith('boq-merge:')) {
    return i18n.t('businessProjects.missingBoqMerge', { detail: item.slice('boq-merge:'.length) })
  }
  if (item.startsWith('resource-schedule:')) {
    return i18n.t('businessProjects.missingResourceSchedule', {
      detail: item.slice('resource-schedule:'.length),
    })
  }
  if (item.startsWith('project-parent:mismatch:')) {
    return i18n.t('businessProjects.missingParentMismatch', {
      detail: item.slice('project-parent:mismatch:'.length),
    })
  }
  if (item.startsWith('planning-substep:')) {
    const rest = item.slice('planning-substep:'.length)
    const [substepId, ...parts] = rest.split(':')
    return i18n.t('businessProjects.missingPlanningSubstep', {
      substep: planningSubstepLabel(substepId ?? ''),
      detail: parts.join(':'),
    })
  }
  if (item === 'task-board:parent-session-required') return i18n.t('businessProjects.missingTaskBoardParent')
  if (item.startsWith('task-board:failed:')) {
    return i18n.t('businessProjects.missingTaskBoardFailed', {
      count: item.slice('task-board:failed:'.length),
    })
  }
  if (item.startsWith('task-board:blocked:')) {
    return i18n.t('businessProjects.missingTaskBoardBlocked', {
      count: item.slice('task-board:blocked:'.length),
    })
  }
  if (item === 'source:registered-file-required') return i18n.t('businessProjects.missingSourceRequired')
  if (item.startsWith('source:')) {
    return i18n.t('businessProjects.missingSource', { detail: item.slice('source:'.length) })
  }
  if (item.startsWith('capability:')) {
    return i18n.t('businessProjects.missingCapability', { detail: item.slice('capability:'.length) })
  }
  if (item.startsWith('output:')) {
    return i18n.t('businessProjects.missingOutput', { detail: item.slice('output:'.length) })
  }
  if (item === 'project_boundary:sa-draft-available') return i18n.t('businessProjects.missingBoundarySaDraft')
  if (item === 'project_boundary:generic-draft-available') return i18n.t('businessProjects.missingBoundaryGenericDraft')
  if (item === 'project_boundary:missing') return i18n.t('businessProjects.missingBoundaryMissing')
  if (item === 'project_boundary:outline') return i18n.t('businessProjects.missingBoundaryOutline')
  if (item === 'project_boundary:measurement') return i18n.t('businessProjects.missingBoundaryMeasurement')
  if (item === 'project_boundary:pricingStandard') return i18n.t('businessProjects.missingBoundaryPricingStandard')
  if (item === 'project_boundary:currency') return i18n.t('businessProjects.missingBoundaryCurrency')
  if (item === 'project_boundary:unconfirmed') return i18n.t('businessProjects.missingBoundaryUnconfirmed')
  if (item === 'project_boundary:parse-incomplete') return i18n.t('businessProjects.missingBoundaryParseIncomplete')
  if (item === 'project_boundary:no-sources') return i18n.t('businessProjects.missingBoundaryNoSources')
  if (item.startsWith('project_boundary:merge:')) {
    return i18n.t('businessProjects.missingBoundaryMerge', {
      detail: item.slice('project_boundary:merge:'.length),
    })
  }
  if (item === 'project-characteristics:evidence-gap') return i18n.t('businessProjects.missingEvidenceGap')
  return item
}
