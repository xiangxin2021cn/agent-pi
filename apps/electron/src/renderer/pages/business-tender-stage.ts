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
  if (item === 'boq-batches:incomplete') return 'BOQ 批次未完成'
  if (item === 'boq-batches:no-items') return 'BOQ 能力包没有清单项'
  if (item === 'boq-batches:manifest-unavailable') return 'BOQ 批次清单尚未生成'
  if (item.startsWith('boq-merge:')) return `BOQ 合并校验失败：${item.slice('boq-merge:'.length)}`
  if (item === 'task-board:parent-session-required') return '必须先创建可见的阶段主会话'
  if (item.startsWith('task-board:failed:')) return `子任务失败 ${item.slice('task-board:failed:'.length)} 个，可重试`
  if (item.startsWith('task-board:blocked:')) return `子任务阻塞 ${item.slice('task-board:blocked:'.length)} 个`
  if (item === 'source:registered-file-required') return '至少登记一份有效资料'
  if (item.startsWith('source:')) return `资料缺失：${item.slice('source:'.length)}`
  if (item.startsWith('capability:')) return `缺少上游能力包：${item.slice('capability:'.length)}`
  if (item.startsWith('output:')) return `尚未生成能力包：${item.slice('output:'.length)}`
  return item
}
