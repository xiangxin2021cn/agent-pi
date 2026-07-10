import type {
  SessionGoalState,
  SessionOrchestrationPhase,
  SessionOrchestrationTaskStatus,
  SessionRequirementLedger,
  SessionSubAgentLifecycleEntry,
} from '@craft-agent/shared/sessions'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type OrchestrationTone = 'default' | 'success' | 'warning' | 'danger'

export interface OrchestrationListItemViewModel {
  id: string
  title: string
  meta: string
  tone: OrchestrationTone
}

export interface OrchestrationEntropyViewModel {
  label: string
  detail: string
  tone: 'warning' | 'danger'
}

export interface OrchestrationLedgerViewModel {
  summary: string
  evidencePackagePath?: string
  tone: OrchestrationTone
}

export interface RequirementLedgerViewModel {
  summary: string
  items: OrchestrationListItemViewModel[]
  hiddenItemCount: number
  tone: OrchestrationTone
}

export interface OrchestrationInfoViewModel {
  phase: string
  selectedSourceBoundary: string
  ledger?: OrchestrationLedgerViewModel
  requirements?: RequirementLedgerViewModel
  taskBoardSummary: string
  tasks: OrchestrationListItemViewModel[]
  hiddenTaskCount: number
  subAgentSummary: string
  subAgents: OrchestrationListItemViewModel[]
  hiddenSubAgentCount: number
  entropy?: OrchestrationEntropyViewModel
}

export interface OrchestrationBadgePreview {
  label: string
  tone: OrchestrationTone
}

const TASK_LIMIT = 5
const SUB_AGENT_LIMIT = 4
const REQUIREMENT_LIMIT = 6

export function getOrchestrationInfoViewModel(
  t: Translate,
  goalState?: SessionGoalState,
  options: { sourceNameBySlug?: Map<string, string> } = {},
): OrchestrationInfoViewModel | undefined {
  const orchestration = goalState?.orchestration
  if (!orchestration) return undefined

  const tasks = orchestration.taskBoard.tasks ?? []
  const subAgents = orchestration.subAgents ?? []
  const selectedSources = formatSelectedSources(t, orchestration.policy.selectedSourceSlugs, options.sourceNameBySlug)
  const boundaryState = orchestration.policy.forbidWorkingDirectoryDiscovery
    ? t('sessionInfo.orchestrationBoundaryEnabled', { defaultValue: '已启用硬边界' })
    : t('sessionInfo.orchestrationBoundarySoft', { defaultValue: '软边界' })
  const entropy = orchestration.entropy
    ? {
        label: t('sessionInfo.orchestrationEntropyLabel', {
          level: orchestration.entropy.level,
          score: orchestration.entropy.score,
          defaultValue: `熵${orchestration.entropy.level === 'high' ? '高' : ''}告警 · ${orchestration.entropy.score}`,
        }),
        detail: orchestration.entropy.reasons.length > 0
          ? orchestration.entropy.reasons.slice(0, 3).join(' · ')
          : t('sessionInfo.orchestrationEntropyNoReason', { defaultValue: '未记录熵告警原因' }),
        tone: orchestration.entropy.level === 'high' ? 'danger' as const : 'warning' as const,
      }
    : undefined
  const ledger = orchestration.ledger
    ? {
        summary: formatLedgerSummary(t, orchestration.ledger),
        evidencePackagePath: orchestration.ledger.evidencePackagePath,
        tone: orchestration.ledger.needsUserConfirmation || orchestration.ledger.blocked > 0 || orchestration.ledger.needsReview > 0
          ? 'warning' as const
          : orchestration.ledger.completed > 0
            ? 'success' as const
            : 'default' as const,
      }
    : undefined
  const requirements = formatRequirementLedger(t, goalState.taskContract?.requirementLedger)

  return {
    phase: getPhaseLabel(t, orchestration.phase),
    selectedSourceBoundary: `${selectedSources} · ${boundaryState}`,
    ledger,
    requirements,
    taskBoardSummary: t('sessionInfo.orchestrationTaskBoardSummary', {
      count: tasks.length,
      defaultValue: `${tasks.length} 项任务`,
    }),
    tasks: tasks.slice(0, TASK_LIMIT).map(task => ({
      id: task.id,
      title: task.title,
      meta: [
        getPhaseLabel(t, task.phase),
        getTaskStatusLabel(t, task.status),
        task.role,
      ].filter(Boolean).join(' · '),
      tone: getTaskTone(task.status),
    })),
    hiddenTaskCount: Math.max(0, tasks.length - TASK_LIMIT),
    subAgentSummary: t('sessionInfo.orchestrationSubAgentSummary', {
      count: subAgents.length,
      defaultValue: `${subAgents.length} 个子智能体`,
    }),
    subAgents: subAgents.slice(0, SUB_AGENT_LIMIT).map(agent => ({
      id: agent.sessionId,
      title: agent.name || agent.taskId || agent.sessionId,
      meta: formatSubAgentMeta(t, agent),
      tone: getSubAgentTone(agent.status),
    })),
    hiddenSubAgentCount: Math.max(0, subAgents.length - SUB_AGENT_LIMIT),
    entropy,
  }
}

function formatRequirementLedger(
  t: Translate,
  ledger: SessionRequirementLedger | undefined,
): RequirementLedgerViewModel | undefined {
  if (!ledger || ledger.entries.length === 0) return undefined

  const counts = {
    satisfied: 0,
    pending: 0,
    blocked: 0,
    failed: 0,
  }
  for (const entry of ledger.entries) counts[entry.status] += 1

  const summary = [
    t('sessionInfo.requirementSatisfied', {
      count: counts.satisfied,
      defaultValue: `${counts.satisfied} satisfied`,
    }),
    t('sessionInfo.requirementPending', {
      count: counts.pending,
      defaultValue: `${counts.pending} pending`,
    }),
    counts.blocked > 0
      ? t('sessionInfo.requirementBlocked', {
          count: counts.blocked,
          defaultValue: `${counts.blocked} blocked`,
        })
      : undefined,
    counts.failed > 0
      ? t('sessionInfo.requirementFailed', {
          count: counts.failed,
          defaultValue: `${counts.failed} failed`,
        })
      : undefined,
  ].filter(Boolean).join(' · ')

  return {
    summary,
    items: ledger.entries.slice(0, REQUIREMENT_LIMIT).map(entry => ({
      id: entry.id,
      title: entry.text,
      meta: [
        getRequirementStatusLabel(t, entry.status),
        entry.verification,
        entry.sourceRefs.length > 0
          ? t('sessionInfo.requirementSourceCount', {
              count: entry.sourceRefs.length,
              defaultValue: `${entry.sourceRefs.length} source${entry.sourceRefs.length === 1 ? '' : 's'}`,
            })
          : undefined,
        (entry.evidenceRefs?.length ?? 0) > 0
          ? t('sessionInfo.requirementEvidenceCount', {
              count: entry.evidenceRefs?.length ?? 0,
              defaultValue: `${entry.evidenceRefs?.length ?? 0} evidence`,
            })
          : undefined,
        entry.failureReason,
      ].filter(Boolean).join(' · '),
      tone: getRequirementTone(entry.status),
    })),
    hiddenItemCount: Math.max(0, ledger.entries.length - REQUIREMENT_LIMIT),
    tone: counts.failed > 0 || counts.blocked > 0
      ? 'danger'
      : counts.pending > 0
        ? 'warning'
        : 'success',
  }
}

function getRequirementStatusLabel(
  t: Translate,
  status: 'pending' | 'satisfied' | 'blocked' | 'failed',
): string {
  switch (status) {
    case 'pending':
      return t('sessionInfo.requirementStatus.pending', { defaultValue: 'Pending' })
    case 'satisfied':
      return t('sessionInfo.requirementStatus.satisfied', { defaultValue: 'Satisfied' })
    case 'blocked':
      return t('sessionInfo.requirementStatus.blocked', { defaultValue: 'Blocked' })
    case 'failed':
      return t('sessionInfo.requirementStatus.failed', { defaultValue: 'Failed' })
  }
}

function getRequirementTone(status: 'pending' | 'satisfied' | 'blocked' | 'failed'): OrchestrationTone {
  switch (status) {
    case 'satisfied':
      return 'success'
    case 'pending':
      return 'warning'
    case 'blocked':
    case 'failed':
      return 'danger'
  }
}

export function getOrchestrationBadgePreview(
  t: Translate,
  goalState?: SessionGoalState,
): OrchestrationBadgePreview | undefined {
  const orchestration = goalState?.orchestration
  if (!orchestration) return undefined

  if (orchestration.entropy) {
    return {
      label: orchestration.entropy.level === 'high'
        ? t('sessionInfo.orchestrationBadgeHighEntropy', { defaultValue: '高熵' })
        : t('sessionInfo.orchestrationBadgeEntropyWarning', { defaultValue: '熵告警' }),
      tone: orchestration.entropy.level === 'high' ? 'danger' : 'warning',
    }
  }

  return {
    label: getPhaseLabel(t, orchestration.phase),
    tone: orchestration.phase === 'done'
      ? 'success'
      : orchestration.phase === 'paused'
        ? 'warning'
        : 'default',
  }
}

function formatLedgerSummary(t: Translate, ledger: NonNullable<SessionGoalState['orchestration']>['ledger']): string {
  if (!ledger) return ''
  const current = ledger.currentTaskId
    ? t('sessionInfo.orchestrationLedgerCurrentTask', {
        taskId: ledger.currentTaskId,
        defaultValue: `当前 ${ledger.currentTaskId}`,
      })
    : t('sessionInfo.orchestrationLedgerNoCurrentTask', { defaultValue: '当前未指定' })
  const parts = [
    current,
    t('sessionInfo.orchestrationLedgerCompleted', {
      count: ledger.completed,
      defaultValue: `完成 ${ledger.completed}`,
    }),
    ledger.running > 0
      ? t('sessionInfo.orchestrationLedgerRunning', {
          count: ledger.running,
          defaultValue: `运行 ${ledger.running}`,
        })
      : undefined,
    ledger.blocked > 0
      ? t('sessionInfo.orchestrationLedgerBlocked', {
          count: ledger.blocked,
          defaultValue: `阻塞 ${ledger.blocked}`,
        })
      : undefined,
    ledger.needsReview > 0
      ? t('sessionInfo.orchestrationLedgerNeedsReview', {
          count: ledger.needsReview,
          defaultValue: `待审查 ${ledger.needsReview}`,
        })
      : undefined,
    ledger.needsUserConfirmation
      ? t('sessionInfo.orchestrationLedgerNeedsUserConfirmation', { defaultValue: '待确认' })
      : undefined,
  ].filter(Boolean)
  return parts.join(' · ')
}

function getPhaseLabel(t: Translate, phase: SessionOrchestrationPhase): string {
  switch (phase) {
    case 'plan':
      return t('sessionInfo.orchestrationPhasePlan', { defaultValue: '计划' })
    case 'audit':
      return t('sessionInfo.orchestrationPhaseAudit', { defaultValue: '审查' })
    case 'merge':
      return t('sessionInfo.orchestrationPhaseMerge', { defaultValue: '合并' })
    case 'paused':
      return t('sessionInfo.orchestrationPhasePaused', { defaultValue: '暂停' })
    case 'done':
      return t('sessionInfo.orchestrationPhaseDone', { defaultValue: 'Completed' })
  }
}

function getTaskStatusLabel(t: Translate, status: SessionOrchestrationTaskStatus): string {
  switch (status) {
    case 'pending':
      return t('sessionInfo.orchestrationTaskPending', { defaultValue: '待办' })
    case 'running':
      return t('sessionInfo.orchestrationTaskRunning', { defaultValue: '运行中' })
    case 'handoff_ready':
      return t('sessionInfo.orchestrationTaskHandoffReady', { defaultValue: '交接就绪' })
    case 'completed':
      return t('sessionInfo.orchestrationTaskCompleted', { defaultValue: '已完成' })
    case 'needs_review':
      return t('sessionInfo.orchestrationTaskNeedsReview', { defaultValue: '待审查' })
    case 'blocked':
      return t('sessionInfo.orchestrationTaskBlocked', { defaultValue: '阻塞' })
    case 'cancelled':
      return t('sessionInfo.orchestrationTaskCancelled', { defaultValue: '已取消' })
  }
}

function formatSelectedSources(t: Translate, slugs: string[], sourceNameBySlug?: Map<string, string>): string {
  if (slugs.length === 0) {
    return t('sessionInfo.orchestrationNoSelectedSources', { defaultValue: '未选择来源' })
  }

  const labels = slugs.map(slug => sourceNameBySlug?.get(slug) ?? slug)
  const visible = labels.slice(0, 3).join(', ')
  if (labels.length <= 3) return visible

  return t('sessionInfo.orchestrationSelectedSourcesMore', {
    sources: visible,
    count: labels.length - 3,
    defaultValue: `${visible} +${labels.length - 3}`,
  })
}

function formatSubAgentMeta(t: Translate, agent: SessionSubAgentLifecycleEntry): string {
  const status = getSubAgentStatusLabel(t, agent.status)
  const sourceText = agent.sourceSlugs.length > 0
    ? t('sessionInfo.orchestrationSubAgentSources', {
        count: agent.sourceSlugs.length,
        defaultValue: `${agent.sourceSlugs.length} 个来源`,
      })
    : undefined
  const taskText = agent.taskId
    ? t('sessionInfo.orchestrationSubAgentTask', {
        taskId: agent.taskId,
        defaultValue: `任务 ${agent.taskId}`,
      })
    : undefined

  return [status, taskText, sourceText].filter(Boolean).join(' · ')
}

function getSubAgentStatusLabel(t: Translate, status: SessionSubAgentLifecycleEntry['status']): string {
  switch (status) {
    case 'started':
      return t('sessionInfo.orchestrationSubAgentStatus.started', { defaultValue: '已启动' })
    case 'handoff_received':
      return t('sessionInfo.orchestrationSubAgentStatus.handoff_received', { defaultValue: '已接收交接' })
    case 'completed':
      return t('sessionInfo.orchestrationSubAgentStatus.completed', { defaultValue: '已完成' })
    case 'needs_review':
      return t('sessionInfo.orchestrationSubAgentStatus.needs_review', { defaultValue: '待审查' })
    case 'failed':
      return t('sessionInfo.orchestrationSubAgentStatus.failed', { defaultValue: '失败' })
  }
}

function getTaskTone(status: SessionOrchestrationTaskStatus): OrchestrationTone {
  switch (status) {
    case 'completed':
    case 'handoff_ready':
      return 'success'
    case 'running':
    case 'needs_review':
      return 'warning'
    case 'blocked':
    case 'cancelled':
      return 'danger'
    case 'pending':
      return 'default'
  }
}

function getSubAgentTone(status: SessionSubAgentLifecycleEntry['status']): OrchestrationTone {
  switch (status) {
    case 'completed':
    case 'handoff_received':
      return 'success'
    case 'started':
    case 'needs_review':
      return 'warning'
    case 'failed':
      return 'danger'
  }
}
