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

export function summarizeTenderStage(result: TenderStageRunResultDto): {
  statusLabel: string
  upstreamLabel?: string
  sourceLabel: string
  batchLabel?: string
  missingLabel?: string
  packsLabel?: string
} {
  const statusLabel = {
    blocked: '阻塞',
    ready: '可开始',
    running: '进行中',
    complete: '已完成',
  }[result.status]
  const readyUpstreamCount = result.requiredCapabilities
    .filter((capability) => result.generatedPacks.includes(capability)).length
  const upstreamLabel = result.requiredCapabilities.length > 0
    ? `上游能力 ${readyUpstreamCount}/${result.requiredCapabilities.length}`
    : undefined
  const sourceLabel = `已登记资料 ${result.sourceBoundary.registeredCount} 份`
  const batchUnit = result.batchProgress?.batchType === 'document_analysis' ? '份资料' : '项'
  const batchLabel = result.batchProgress
    ? [
        `批次 ${result.batchProgress.completedBatches}/${result.batchProgress.batchCount}`,
        result.batchProgress.runningBatches > 0 ? `运行 ${result.batchProgress.runningBatches}` : undefined,
        result.batchProgress.pendingBatches > 0 ? `排队 ${result.batchProgress.pendingBatches}` : undefined,
        result.batchProgress.failedBatches > 0 ? `失败 ${result.batchProgress.failedBatches}` : undefined,
        result.batchProgress.blockedBatches > 0 ? `阻塞 ${result.batchProgress.blockedBatches}` : undefined,
        `待覆盖 ${result.batchProgress.missingItemCount} ${batchUnit}`,
      ].filter(Boolean).join(' · ')
    : undefined
  const missingLabel = result.missingItems.length > 0
    ? result.missingItems.map(formatMissingItem).join('；')
    : undefined
  const packsLabel = result.generatedPacks.length > 0
    ? `已有能力包：${result.generatedPacks.join(', ')}`
    : undefined
  return { statusLabel, upstreamLabel, sourceLabel, batchLabel, missingLabel, packsLabel }
}

function formatMissingItem(item: string): string {
  if (item === 'document-batches:incomplete') return '资料分析批次未完成'
  if (item === 'document-batches:no-documents') return '没有可分析的已登记资料'
  if (item === 'document-batches:manifest-unavailable') return '资料分析批次清单尚未生成'
  if (item.startsWith('document-merge:')) return `资料分析合并校验失败：${item.slice('document-merge:'.length)}`
  if (item.startsWith('document-review:missing-md:')) {
    return `缺少可读解析 MD：${item.slice('document-review:missing-md:'.length)}`
  }
  if (item.startsWith('document-review:pending:')) {
    return `待人审解析稿：${item.slice('document-review:pending:'.length)}`
  }
  if (item.startsWith('document-review:')) return `资料人审未通过：${item.slice('document-review:'.length)}`
  if (item === 'boq-batches:incomplete') return 'BOQ 批次未完成'
  if (item === 'boq-batches:no-items') return 'BOQ 能力包没有清单项'
  if (item === 'boq-batches:manifest-unavailable') return 'BOQ 批次清单尚未生成'
  if (item.startsWith('boq-merge:')) return `BOQ 合并校验失败：${item.slice('boq-merge:'.length)}`
  if (item.startsWith('resource-schedule:')) return `施工资源消耗总表：${item.slice('resource-schedule:'.length)}`
  if (item.startsWith('project-parent:mismatch:')) {
    return `请使用项目主会话（${item.slice('project-parent:mismatch:'.length)}），不要另开阶段主对话`
  }
  if (item.startsWith('planning-substep:')) {
    const rest = item.slice('planning-substep:'.length)
    const [substepId, ...parts] = rest.split(':')
    const detail = parts.join(':')
    const labels: Record<string, string> = {
      'plan-methodology': '4-A 施工策划',
      'plan-programme-resources-cashflow': '4-B 进度·资源·现金流',
      'plan-submission': '4-C 正式出稿',
    }
    return `${labels[substepId ?? ''] ?? substepId}：${detail}`
  }
  if (item === 'task-board:parent-session-required') return '必须先创建可见的阶段主会话'
  if (item.startsWith('task-board:failed:')) return `子任务失败 ${item.slice('task-board:failed:'.length)} 个，可重试`
  if (item.startsWith('task-board:blocked:')) return `子任务阻塞 ${item.slice('task-board:blocked:'.length)} 个`
  if (item === 'source:registered-file-required') return '至少登记一份有效资料'
  if (item.startsWith('source:')) return `资料缺失：${item.slice('source:'.length)}`
  if (item.startsWith('capability:')) return `缺少上游能力包：${item.slice('capability:'.length)}`
  if (item.startsWith('output:')) return `尚未生成能力包：${item.slice('output:'.length)}`
  return item
}
