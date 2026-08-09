import * as React from 'react'
import { FilePlus2, FolderOpen, MessageSquarePlus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { preflightTenderStageLaunch, startTenderStageLaunch, summarizeTenderStage } from '@/pages/business-tender-stage'
import { getBusinessWorkflow, type BusinessWorkflowStage } from '@/pages/business-workflows'
import { cn } from '@/lib/utils'

interface BusinessProjectOverviewProps {
  moduleId: BusinessModuleId
  workspaceRootPath: string
  projectId: string
}

const LIVE_POLL_MS = 2_500
const IDLE_POLL_MS = 15_000
const TICK_MS = 1_000

function stageHasLiveWork(run?: TenderStageRunResultDto): boolean {
  if (!run) return false
  if (run.status === 'running') return true
  const progress = run.batchProgress
  if (!progress) return false
  return progress.runningBatches > 0 || progress.pendingBatches > 0
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

export function BusinessProjectOverview({ moduleId, workspaceRootPath, projectId }: BusinessProjectOverviewProps) {
  const { openNewChat, onOpenFile } = useAppShellContext()
  const workflow = React.useMemo(() => getBusinessWorkflow(moduleId), [moduleId])
  const [project, setProject] = React.useState<BusinessProjectRecord | null>(null)
  const [stageRuns, setStageRuns] = React.useState<Record<string, TenderStageRunResultDto>>({})
  const [startingStageId, setStartingStageId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [expandedStageIds, setExpandedStageIds] = React.useState<Record<string, boolean>>({})
  const refreshInFlight = React.useRef(false)
  const pollTickRef = React.useRef(0)
  const stageRunsRef = React.useRef(stageRuns)
  stageRunsRef.current = stageRuns

  const liveMonitoring = React.useMemo(
    () => Object.values(stageRuns).some((run) => stageHasLiveWork(run)),
    [stageRuns],
  )

  const refresh = React.useCallback(async (options?: { force?: boolean }) => {
    if (refreshInFlight.current && !options?.force) return
    refreshInFlight.current = true
    setRefreshing(true)
    try {
      const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
      const selected = projects.find((entry) => entry.projectId === projectId) ?? null
      setProject(selected)
      if (moduleId === 'tender' && selected) {
        const currentRuns = stageRunsRef.current
        const hasLive = Object.values(currentRuns).some((run) => stageHasLiveWork(run))
        pollTickRef.current += 1
        // While live, poll only active/problem stages every tick; full sweep about every 15s.
        const fullSweep = options?.force || !hasLive || pollTickRef.current % Math.max(1, Math.round(IDLE_POLL_MS / LIVE_POLL_MS)) === 0
        const targets = fullSweep
          ? workflow.stages
          : workflow.stages.filter((stage) => {
              const run = currentRuns[stage.id]
              return !run || stageHasLiveWork(run) || run.status === 'blocked' || Boolean(run.batchProgress?.failedBatches)
            })
        const results = await Promise.all(targets.map(async (stage) => {
          try {
            return [stage.id, await window.electronAPI.runTenderStage({
              action: 'status', workspaceRootPath, projectId: selected.projectId, stageId: stage.id,
            })] as const
          } catch {
            return null
          }
        }))
        // Merge — never drop a stage that timed out on this tick.
        setStageRuns((current) => {
          const next = { ...current }
          for (const entry of results) {
            if (!entry) continue
            next[entry[0]] = entry[1]
          }
          return next
        })
        setExpandedStageIds((current) => {
          const next = { ...current }
          for (const entry of results) {
            if (!entry) continue
            const [stageId, run] = entry
            if (stageHasLiveWork(run) && current[stageId] === undefined) {
              next[stageId] = true
            }
          }
          return next
        })
      } else {
        setStageRuns({})
      }
      setLastRefreshAt(Date.now())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
    }
  }, [moduleId, projectId, workflow.stages, workspaceRootPath])

  React.useEffect(() => {
    void refresh({ force: true })
    const handleChanged = () => void refresh({ force: true })
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => window.removeEventListener('craft:business-projects-changed', handleChanged)
  }, [refresh])

  React.useEffect(() => {
    const intervalMs = liveMonitoring ? LIVE_POLL_MS : IDLE_POLL_MS
    const timer = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(timer)
  }, [liveMonitoring, refresh])

  React.useEffect(() => {
    if (!liveMonitoring) return
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [liveMonitoring])

  React.useEffect(() => {
    if (moduleId !== 'tender') return
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
        return run.batchProgress?.tasks.some((task) => task.sessionId === event.sessionId) ?? false
      })
      if (related) void refresh()
    })
    return cleanup
  }, [moduleId, refresh])

  const handleAddInputs = async () => {
    if (!project) return
    const result = await window.electronAPI.openAttachmentDialog('files')
    if (result.attachments.length === 0) return
    const inputPaths = [...new Set([...project.inputPaths, ...result.attachments.map((item) => item.path)])]
    const updated = await window.electronAPI.updateBusinessProjectInputs({ workspaceRootPath, module: moduleId, projectId, inputPaths })
    setProject(updated)
    window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
    toast.success(`已登记 ${updated.inputPaths.length} 个项目资料文件`)
    void refresh({ force: true })
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
        }
      }
    } finally {
      setStartingStageId(null)
      void refresh({ force: true })
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
      void refresh({ force: true })
    }
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">流程监控</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">长程批次实时刷新；槽位满时保持排队，不会因等待误标失败</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <span className={cn('inline-flex items-center gap-1.5', liveMonitoring && 'text-accent')}>
              <span className={cn('size-1.5 rounded-full', liveMonitoring ? 'animate-pulse bg-accent' : 'bg-muted-foreground/40')} />
              {liveMonitoring ? `实时 ${LIVE_POLL_MS / 1000}s` : `空闲 ${IDLE_POLL_MS / 1000}s`}
            </span>
            <span title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : undefined}>
              刷新于 {lastRefreshAt ? formatClock(new Date(lastRefreshAt).toISOString()) : '—'}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh({ force: true })}>
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>

        <div className="mt-3 divide-y">
          {workflow.stages.map((stage, index) => {
            const run = stageRuns[stage.id]
            const summary = run ? summarizeTenderStage(run) : null
            const progress = run?.batchProgress
            const live = stageHasLiveWork(run)
            const completed = progress?.completedBatches ?? 0
            const total = progress?.batchCount ?? 0
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0
            const expanded = expandedStageIds[stage.id] ?? live
            const failed = progress?.failedBatches ?? 0
            return (
              <div key={stage.id} className="py-3">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 w-6 text-sm text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{stage.label}</p>
                      {live && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">监控中</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{stage.prompt}</p>
                    {summary && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className={cn(
                          'font-medium',
                          run!.status === 'blocked' && 'text-destructive',
                          run!.status === 'complete' && 'text-success',
                          run!.status === 'running' && 'text-accent',
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
                                    <p className="truncate text-foreground" title={task.name}>{task.name}</p>
                                    <p className="truncate text-muted-foreground" title={task.error ?? task.reportPath}>
                                      {task.error
                                        ?? [
                                          task.sessionId ? `会话 ${task.sessionId}` : null,
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={startingStageId !== null || (live && !failed) || (run?.status === 'blocked' && !failed && !live)}
                    title={live && !failed
                      ? '阶段进行中，面板自动刷新监控'
                      : run?.status === 'blocked' && !live ? summary?.missingLabel : undefined}
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

function taskStatusLabel(status: NonNullable<TenderStageRunResultDto['batchProgress']>['tasks'][number]['status']): string {
  return {
    pending: '排队',
    running: '运行',
    complete: '完成',
    failed: '失败',
    blocked: '阻塞',
  }[status]
}
