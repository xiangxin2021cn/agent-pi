import * as React from 'react'
import { FilePlus2, FolderOpen, MessageSquarePlus, RefreshCw, PlayCircle, SearchCheck, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import {
  preflightTenderStageLaunch,
  resumeTenderStageLaunch,
  startTenderStageLaunch,
  summarizeTenderStage,
} from '@/pages/business-tender-stage'
import { getBusinessWorkflow, type BusinessWorkflowStage } from '@/pages/business-workflows'
import { routes } from '../../../shared/routes'
import { cn } from '@/lib/utils'

interface BusinessProjectOverviewProps {
  moduleId: BusinessModuleId
  workspaceRootPath: string
  projectId: string
}

const LIVE_POLL_MS = 20_000
const TICK_MS = 1_000

type StageTask = NonNullable<TenderStageRunResultDto['batchProgress']>['tasks'][number]

function stageHasLiveWork(run?: TenderStageRunResultDto): boolean {
  if (!run) return false
  const progress = run.batchProgress
  if (!progress) return false
  // Only truly active children — pending alone must not auto-enable live monitor.
  return progress.runningBatches > 0
    || progress.tasks.some((task) => task.status === 'running' && task.linkedIsProcessing !== false)
}

function stageHasResumableWork(run?: TenderStageRunResultDto): boolean {
  if (!run?.batchProgress) return false
  return run.batchProgress.pendingBatches > 0
    || run.batchProgress.failedBatches > 0
    || run.batchProgress.runningBatches > 0
}

function formatElapsed(fromIso: string | undefined, nowMs: number): string | null {
  if (!fromIso) return null
  const started = Date.parse(fromIso)
  if (!Number.isFinite(started)) return null
  const elapsedSec = Math.max(0, Math.floor((nowMs - started) / 1000))
  const hours = Math.floor(elapsedSec / 3600)
  const minutes = Math.floor((elapsedSec % 3600) / 60)
  const seconds = elapsedSec % 60
  if (hours > 0) return `${hours}时${minutes}分`
  if (minutes > 0) return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
  return `${seconds}秒`
}

function formatClock(iso: string | undefined): string {
  if (!iso) return '—'
  const value = Date.parse(iso)
  if (!Number.isFinite(value)) return '—'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function linkedSessionId(task: StageTask): string | undefined {
  return task.sessionId ?? task.lastSessionId
}

export function BusinessProjectOverview({ moduleId, workspaceRootPath, projectId }: BusinessProjectOverviewProps) {
  const { openNewChat, onOpenFile } = useAppShellContext()
  const { navigate } = useNavigation()
  const workflow = React.useMemo(() => getBusinessWorkflow(moduleId), [moduleId])
  const [project, setProject] = React.useState<BusinessProjectRecord | null>(null)
  const [stageRuns, setStageRuns] = React.useState<Record<string, TenderStageRunResultDto>>({})
  const [startingStageId, setStartingStageId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [expandedStageIds, setExpandedStageIds] = React.useState<Record<string, boolean>>({})
  /** Opt-in only — never auto-enable on open from persisted pending/running board state. */
  const [monitoringActive, setMonitoringActive] = React.useState(false)
  const refreshInFlight = React.useRef(false)
  const stageRunsRef = React.useRef(stageRuns)
  stageRunsRef.current = stageRuns

  const refresh = React.useCallback(async (options?: {
    force?: boolean
    /** status = inspect/reconcile only; resume = reconcile + dispatch pending. */
    action?: 'status' | 'resume'
    stages?: BusinessWorkflowStage[]
  }): Promise<Record<string, TenderStageRunResultDto>> => {
    if (refreshInFlight.current && !options?.force) return stageRunsRef.current
    refreshInFlight.current = true
    setRefreshing(true)
    const action = options?.action ?? 'status'
    try {
      const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
      const selected = projects.find((entry) => entry.projectId === projectId) ?? null
      setProject(selected)
      if (moduleId === 'tender' && selected) {
        const currentRuns = stageRunsRef.current
        const targets = options?.stages ?? (
          options?.force
            ? workflow.stages
            : workflow.stages.filter((stage) => {
                const run = currentRuns[stage.id]
                return !run || stageHasLiveWork(run) || stageHasResumableWork(run) || run.status === 'blocked'
              })
        )
        const results = await Promise.all(targets.map(async (stage) => {
          try {
            const parentSessionId = currentRuns[stage.id]?.batchProgress?.parentSessionId
            return [stage.id, await window.electronAPI.runTenderStage({
              action,
              workspaceRootPath,
              projectId: selected.projectId,
              stageId: stage.id,
              ...(action === 'resume' && parentSessionId ? { parentSessionId } : {}),
            })] as const
          } catch {
            return null
          }
        }))
        const next = { ...currentRuns }
        for (const entry of results) {
          if (!entry) continue
          next[entry[0]] = entry[1]
        }
        stageRunsRef.current = next
        setStageRuns(next)
        setExpandedStageIds((current) => {
          const expanded = { ...current }
          for (const entry of results) {
            if (!entry) continue
            const [stageId, run] = entry
            if ((stageHasLiveWork(run) || stageHasResumableWork(run)) && current[stageId] === undefined) {
              expanded[stageId] = true
            }
          }
          return expanded
        })
        setLastRefreshAt(Date.now())
        setError(null)
        return next
      }
      stageRunsRef.current = {}
      setStageRuns({})
      setLastRefreshAt(Date.now())
      setError(null)
      return {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return stageRunsRef.current
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
    }
  }, [moduleId, projectId, workflow.stages, workspaceRootPath])

  // Snapshot inspect on open / project list change — never auto-dispatch or auto-monitor.
  React.useEffect(() => {
    setMonitoringActive(false)
    void refresh({ force: true, action: 'status' })
    const handleChanged = () => void refresh({ force: true, action: 'status' })
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => window.removeEventListener('craft:business-projects-changed', handleChanged)
  }, [refresh])

  React.useEffect(() => {
    if (!monitoringActive) return
    const timer = window.setInterval(() => void refresh({ action: 'resume' }), LIVE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [monitoringActive, refresh])

  React.useEffect(() => {
    if (!monitoringActive) return
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [monitoringActive])

  // Auto-stop monitor when nothing is actually running anymore.
  React.useEffect(() => {
    if (!monitoringActive) return
    const stillLive = Object.values(stageRuns).some((run) => stageHasLiveWork(run) || stageHasResumableWork(run))
    if (!stillLive && lastRefreshAt !== null) {
      setMonitoringActive(false)
    }
  }, [monitoringActive, stageRuns, lastRefreshAt])

  React.useEffect(() => {
    if (moduleId !== 'tender' || !monitoringActive) return
    const cleanup = window.electronAPI.onSessionEvent((event) => {
      if (
        event.type !== 'complete'
        && event.type !== 'error'
        && event.type !== 'session_status_changed'
        && event.type !== 'goal_state_changed'
      ) return
      if (!('sessionId' in event)) return
      const related = Object.values(stageRunsRef.current).some((run) => {
        if (run.batchProgress?.parentSessionId === event.sessionId) return true
        return run.batchProgress?.tasks.some((task) => linkedSessionId(task) === event.sessionId) ?? false
      })
      if (related) void refresh({ action: 'resume' })
    })
    return cleanup
  }, [moduleId, monitoringActive, refresh])

  const handleInspect = async () => {
    await refresh({ force: true, action: 'status' })
    toast.success('已检查：已与左侧会话状态对齐，未自动调度')
  }

  const handleResumeUnfinished = async () => {
    if (!project) return
    setStartingStageId('__resume__')
    try {
      const inspected = await refresh({ force: true, action: 'status' })
      const targets = workflow.stages.filter((stage) => stageHasResumableWork(inspected[stage.id]))
      if (targets.length === 0) {
        toast.message('没有可恢复的未完批次；请先进入阶段或重试失败批次')
        return
      }
      await refresh({ force: true, action: 'resume', stages: targets })
      setMonitoringActive(true)
      toast.success('已恢复未完任务，并开启流程监控')
    } finally {
      setStartingStageId(null)
    }
  }

  const handleAddInputs = async () => {
    if (!project) return
    const result = await window.electronAPI.openAttachmentDialog('files')
    if (result.attachments.length === 0) return
    const inputPaths = [...new Set([...project.inputPaths, ...result.attachments.map((item) => item.path)])]
    const updated = await window.electronAPI.updateBusinessProjectInputs({ workspaceRootPath, module: moduleId, projectId, inputPaths })
    setProject(updated)
    window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
    toast.success(`已登记 ${updated.inputPaths.length} 个项目资料文件`)
    void refresh({ force: true, action: 'status' })
  }

  const handleStartStage = async (stage: BusinessWorkflowStage) => {
    if (!project) return
    setStartingStageId(stage.id)
    try {
      let stageRun: TenderStageRunResultDto | undefined
      if (moduleId === 'tender') {
        const launch = await preflightTenderStageLaunch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId: project.projectId, stageId: stage.id,
        })
        stageRun = launch.result
        setStageRuns((current) => ({ ...current, [stage.id]: launch.result }))
        if (!launch.ok) {
          const summary = summarizeTenderStage(launch.result)
          toast.error(`阶段尚未就绪：${summary.missingLabel ?? summary.statusLabel}`)
          return
        }
      }
      const parentSession = await openNewChat?.({
        name: `${project.name} · ${stage.label}`,
        workingDirectory: project.rootPath,
        businessContext: { module: moduleId, projectId: project.projectId, workflowId: project.workflowId, stageId: stage.id },
        input: buildBusinessTaskDraft(moduleId, project, stage, stageRun),
      })
      if (moduleId === 'tender' && parentSession) {
        const launch = await startTenderStageLaunch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId: project.projectId, stageId: stage.id,
        }, parentSession.id)
        setStageRuns((current) => ({ ...current, [stage.id]: launch.result }))
        setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
        if (!launch.ok) {
          const summary = summarizeTenderStage(launch.result)
          toast.error(`阶段启动失败：${summary.missingLabel ?? summary.statusLabel}`)
        } else {
          setMonitoringActive(true)
        }
      }
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleRetryStage = async (stage: BusinessWorkflowStage) => {
    const run = stageRuns[stage.id]
    const parentSessionId = run?.batchProgress?.parentSessionId
    if (!parentSessionId) {
      await handleStartStage(stage)
      return
    }
    setStartingStageId(stage.id)
    try {
      const retried = await startTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, parentSessionId)
      setStageRuns((current) => ({ ...current, [stage.id]: retried.result }))
      setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
      const progress = retried.result.batchProgress
      const inFlight = (progress?.runningBatches ?? 0) + (progress?.pendingBatches ?? 0)
      if (retried.ok || inFlight > 0) {
        setMonitoringActive(true)
        toast.success(
          progress
            ? `已重新调度：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
            : '已重新调度失败批次',
        )
        return
      }
      const summary = summarizeTenderStage(retried.result)
      toast.error(`重试失败：${summary.missingLabel ?? summary.statusLabel}`)
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleResumeStage = async (stage: BusinessWorkflowStage) => {
    const parentSessionId = stageRuns[stage.id]?.batchProgress?.parentSessionId
    if (!parentSessionId) {
      await handleStartStage(stage)
      return
    }
    setStartingStageId(stage.id)
    try {
      const resumed = await resumeTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, parentSessionId)
      setStageRuns((current) => ({ ...current, [stage.id]: resumed.result }))
      setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
      setMonitoringActive(true)
      const progress = resumed.result.batchProgress
      toast.success(
        progress
          ? `已恢复调度：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
          : '已恢复未完任务',
      )
    } finally {
      setStartingStageId(null)
    }
  }

  const openLinkedSession = (sessionId: string) => {
    navigate(routes.view.tenderWorkspaces(projectId, sessionId))
  }

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!project) return <div className="p-6 text-sm text-muted-foreground">未找到该项目，请从左侧项目列表重新选择。</div>

  return (
    <div className="h-full overflow-auto">
      <header className="border-b px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{project.name}</h1>
            <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground" title={project.rootPath}>
              <FolderOpen className="size-4 shrink-0" />{project.rootPath}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => void handleAddInputs()}><FilePlus2 className="size-4" />添加资料</Button>
            <Button type="button" onClick={() => void handleStartStage(workflow.stages[0]!)}><MessageSquarePlus className="size-4" />新建任务</Button>
          </div>
        </div>
      </header>

      <section className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">流程监控</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              打开项目仅快照检查，不会自动调度。先点「检查」对齐左侧会话，再点「恢复未完任务」唤起排队。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('inline-flex items-center gap-1.5', monitoringActive && 'text-accent')}>
              <span className={cn('size-1.5 rounded-full', monitoringActive ? 'animate-pulse bg-accent' : 'bg-muted-foreground/40')} />
              {monitoringActive ? `监控中 ${LIVE_POLL_MS / 1000}s` : '监控未开启'}
            </span>
            <span title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : undefined}>
              检查于 {lastRefreshAt ? formatClock(new Date(lastRefreshAt).toISOString()) : '—'}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void handleInspect()}>
              <SearchCheck className={cn('size-3.5', refreshing && !monitoringActive && 'animate-pulse')} />
              检查
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={refreshing || startingStageId !== null}
              onClick={() => void handleResumeUnfinished()}
            >
              <PlayCircle className="size-3.5" />
              {startingStageId === '__resume__' ? '恢复中…' : '恢复未完任务'}
            </Button>
            {monitoringActive ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setMonitoringActive(false)}>
                <Square className="size-3.5" />
                停止监控
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh({ force: true, action: 'status' })}>
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
                刷新快照
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 divide-y">
          {workflow.stages.map((stage, index) => {
            const run = stageRuns[stage.id]
            const summary = run ? summarizeTenderStage(run) : null
            const progress = run?.batchProgress
            const live = monitoringActive && stageHasLiveWork(run)
            const resumable = stageHasResumableWork(run)
            const completed = progress?.completedBatches ?? 0
            const total = progress?.batchCount ?? 0
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0
            const expanded = expandedStageIds[stage.id] ?? (live || resumable)
            const failed = progress?.failedBatches ?? 0
            return (
              <div key={stage.id} className="py-3">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 w-6 text-sm text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{stage.label}</p>
                      {live && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">监控中</span>}
                      {!live && resumable && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">有未完任务</span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{stage.prompt}</p>
                    {summary && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className={cn(
                          'font-medium',
                          run!.status === 'blocked' && 'text-destructive',
                          run!.status === 'complete' && 'text-success',
                          (run!.status === 'running' || live) && 'text-accent',
                        )}>{summary.statusLabel}</span>
                        {summary.upstreamLabel && <span>{summary.upstreamLabel}</span>}
                        <span>{summary.sourceLabel}</span>
                        {summary.batchLabel && <span>{summary.batchLabel}</span>}
                        {summary.missingLabel && <span className="max-w-full truncate" title={summary.missingLabel}>{summary.missingLabel}</span>}
                        {summary.packsLabel && <span className="max-w-full truncate" title={summary.packsLabel}>{summary.packsLabel}</span>}
                      </div>
                    )}
                    {progress && total > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>批次进度 {completed}/{total}（{percent}%）</span>
                          <span>
                            运行 {progress.runningBatches} · 排队 {progress.pendingBatches}
                            {failed > 0 ? ` · 失败 ${failed}` : ''}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', failed > 0 ? 'bg-destructive' : 'bg-accent')}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {progress?.tasks.length ? (
                      <div className="mt-2 text-xs">
                        <button
                          type="button"
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={() => setExpandedStageIds((current) => ({ ...current, [stage.id]: !expanded }))}
                        >
                          {expanded ? '收起批次任务' : '查看批次任务'}（{progress.tasks.length}）
                        </button>
                        {expanded && (
                          <div className="mt-2 max-h-80 overflow-auto divide-y border-y">
                            {progress.tasks.map((task) => {
                              const duration = task.status === 'running'
                                ? formatElapsed(task.startedAt, nowMs)
                                : task.status === 'complete' && task.startedAt && task.completedAt
                                  ? formatElapsed(task.startedAt, Date.parse(task.completedAt))
                                  : null
                              const sessionId = linkedSessionId(task)
                              const idleLinked = Boolean(sessionId) && task.linkedIsProcessing === false
                              return (
                                <div key={task.batchId} className="flex items-start gap-3 py-2">
                                  <span className={cn(
                                    'w-12 shrink-0 font-medium',
                                    task.status === 'complete' && 'text-success',
                                    task.status === 'running' && 'text-accent',
                                    task.status === 'pending' && 'text-muted-foreground',
                                    (task.status === 'failed' || task.status === 'blocked') && 'text-destructive',
                                  )}>{taskStatusLabel(task.status)}</span>
                                  <div className="min-w-0 flex-1">
                                    {sessionId ? (
                                      <button
                                        type="button"
                                        className="block w-full truncate text-left text-foreground hover:text-primary hover:underline"
                                        title={`打开左侧会话 ${sessionId}`}
                                        onClick={() => openLinkedSession(sessionId)}
                                      >
                                        {task.name}
                                      </button>
                                    ) : (
                                      <p className="truncate text-foreground" title={task.name}>{task.name}</p>
                                    )}
                                    <p className="truncate text-muted-foreground" title={task.error ?? task.reportPath}>
                                      {task.error
                                        ?? [
                                          sessionId ? (idleLinked ? `左侧空闲 · ${sessionId}` : `会话 ${sessionId}`) : null,
                                          task.linkedSessionStatus ? `状态 ${task.linkedSessionStatus}` : null,
                                          `尝试 ${task.attemptCount}`,
                                          duration ? (task.status === 'running' ? `已运行 ${duration}` : `耗时 ${duration}`) : null,
                                          task.updatedAt ? `更新 ${formatClock(task.updatedAt)}` : null,
                                        ].filter(Boolean).join(' · ')}
                                    </p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {resumable && !failed && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={startingStageId !== null}
                        onClick={() => void handleResumeStage(stage)}
                      >{startingStageId === stage.id ? '恢复中…' : '恢复本阶段'}</Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={startingStageId !== null || (live && !failed) || (run?.status === 'blocked' && !failed && !resumable)}
                      title={live && !failed
                        ? '阶段监控中'
                        : run?.status === 'blocked' && !resumable ? summary?.missingLabel : undefined}
                      onClick={() => void (failed ? handleRetryStage(stage) : handleStartStage(stage))}
                    >{startingStageId === stage.id
                        ? '处理中…'
                        : failed
                          ? '重试失败批次'
                          : live
                            ? '监控中'
                            : '进入阶段'}</Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="px-6 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">项目资料</h2>
          <span className="text-xs text-muted-foreground">仅限用户明确登记的文件</span>
        </div>
        <div className="mt-3 divide-y">
          {project.inputPaths.length === 0 && <p className="py-6 text-sm text-muted-foreground">尚未登记资料。</p>}
          {project.inputPaths.map((path) => (
            <button key={path} type="button" onClick={() => onOpenFile(path)} className="block w-full truncate py-2 text-left text-sm hover:text-primary" title={path}>
              {path.split(/[\\/]/).pop() || path}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function taskStatusLabel(status: StageTask['status']): string {
  return {
    pending: '排队',
    running: '运行',
    complete: '完成',
    failed: '失败',
    blocked: '阻塞',
  }[status]
}
