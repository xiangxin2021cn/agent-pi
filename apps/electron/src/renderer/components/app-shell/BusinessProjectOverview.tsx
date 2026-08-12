import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FilePlus2, FolderOpen, MessageSquarePlus, RefreshCw, PlayCircle, SearchCheck, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import {
  businessProjectsCacheAtom,
  businessProjectsCacheKey,
  findCachedBusinessProject,
} from '@/atoms/business-projects'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { isTenderMonitorActiveFor, tenderLiveMonitorAtom } from '@/atoms/tender-monitor'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { buildBusinessTaskDraft, buildStageHandoffDraft } from '@/pages/business-module-launcher'
import {
  acceptPlanningMethodologyReview,
  advanceTenderStageLaunch,
  enterTenderStageInProjectParent,
  preflightTenderStageLaunch,
  resetTenderStageOrchestration,
  resolveProjectParentSessionId,
  resolveStageParentSessionId,
  resumeTenderStageLaunch,
  setTenderStageDispatch,
  startAndAdvanceTenderStageLaunch,
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

const LIVE_POLL_MS = 45_000
const TICK_MS = 1_000

type StageTask = NonNullable<TenderStageRunResultDto['batchProgress']>['tasks'][number]

function stageHasLiveWork(run?: TenderStageRunResultDto): boolean {
  if (!run) return false
  const progress = run.batchProgress
  if (!progress) return false
  // Active children, or a "failed" row still rewriting in a linked session.
  return progress.runningBatches > 0
    || progress.tasks.some((task) => (
      task.status === 'running'
      || (task.linkedIsProcessing === true && task.status !== 'complete')
    ))
}

function stageHasResumableWork(run?: TenderStageRunResultDto): boolean {
  if (!run?.batchProgress) return false
  return run.batchProgress.pendingBatches > 0
    || run.batchProgress.failedBatches > 0
    || run.batchProgress.runningBatches > 0
}

/** Invalid-report banner must not invite a second retry while that batch is mid-flight. */
function actionableInvalidBatches(
  progress: NonNullable<TenderStageRunResultDto['batchProgress']>,
): NonNullable<TenderStageRunResultDto['batchProgress']>['invalidBatches'] {
  const invalid = progress.invalidBatches ?? []
  if (invalid.length === 0) return []
  const taskByBatchId = new Map(progress.tasks.map((task) => [task.batchId, task]))
  return invalid.filter((batch) => {
    const task = taskByBatchId.get(batch.batchId)
    if (!task) return true
    if (task.status === 'running' || task.status === 'pending' || task.status === 'complete') return false
    if (task.linkedIsProcessing) return false
    return true
  })
}

function taskIsMidFlight(task: StageTask): boolean {
  return task.status === 'running'
    || (task.linkedIsProcessing === true && task.status !== 'complete')
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
  const { t } = useTranslation()
  const { openNewChat, onOpenFile } = useAppShellContext()
  const { navigate } = useNavigation()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMetaMapRef = React.useRef(sessionMetaMap)
  sessionMetaMapRef.current = sessionMetaMap
  const [projectsCache, setProjectsCache] = useAtom(businessProjectsCacheAtom)
  const projectsCacheRef = React.useRef(projectsCache)
  projectsCacheRef.current = projectsCache
  const [liveMonitor, setLiveMonitor] = useAtom(tenderLiveMonitorAtom)
  const workflow = React.useMemo(() => getBusinessWorkflow(moduleId), [moduleId])
  const cachedProject = findCachedBusinessProject(projectsCache, moduleId, workspaceRootPath, projectId)
  const [project, setProject] = React.useState<BusinessProjectRecord | null>(cachedProject)
  const projectRef = React.useRef(project)
  projectRef.current = project
  const [projectLoadState, setProjectLoadState] = React.useState<'loading' | 'ready' | 'missing'>(
    cachedProject ? 'ready' : 'loading',
  )
  const [stageRuns, setStageRuns] = React.useState<Record<string, TenderStageRunResultDto>>({})
  const [startingStageId, setStartingStageId] = React.useState<string | null>(null)
  const [retryingBatchId, setRetryingBatchId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  const [expandedStageIds, setExpandedStageIds] = React.useState<Record<string, boolean>>({})
  /** Survives chat navigation via tenderLiveMonitorAtom (host keeps resume polling). */
  const monitoringActive = moduleId === 'tender'
    && isTenderMonitorActiveFor(liveMonitor, projectId, workspaceRootPath)
  const setMonitoringActive = React.useCallback((active: boolean) => {
    if (moduleId !== 'tender') return
    setLiveMonitor(active
      ? {
          moduleId: 'tender',
          workspaceRootPath,
          projectId,
          active: true,
          lastTickAt: Date.now(),
        }
      : (current) => (
        current?.projectId === projectId
          ? { ...current, active: false, lastTickAt: Date.now() }
          : current
      ))
  }, [moduleId, projectId, setLiveMonitor, workspaceRootPath])
  const refreshInFlight = React.useRef(false)
  const refreshQueued = React.useRef<{ action: 'status' | 'resume'; stages?: BusinessWorkflowStage[] } | null>(null)
  const stageRunsRef = React.useRef(stageRuns)
  stageRunsRef.current = stageRuns

  const refresh = React.useCallback(async (options?: {
    force?: boolean
    /** status = inspect/reconcile only; resume = reconcile + dispatch pending. */
    action?: 'status' | 'resume'
    stages?: BusinessWorkflowStage[]
    /** Skip businessProjects:list when we already have a warm project (monitor/event ticks). */
    skipProjectList?: boolean
  }): Promise<Record<string, TenderStageRunResultDto>> => {
    const requestedAction = options?.action ?? 'status'
    // Coalesce overlapping refreshes — force must NOT pile concurrent stageRuns
    // (sessionMetaMap churn previously recreated this callback and stacked IPC).
    if (refreshInFlight.current) {
      refreshQueued.current = {
        action: requestedAction,
        ...(options?.stages ? { stages: options.stages } : {}),
      }
      return stageRunsRef.current
    }
    refreshInFlight.current = true
    setRefreshing(true)
    let action = requestedAction
    let stageFilter = options?.stages
    let forceAll = Boolean(options?.force)
    let skipProjectList = Boolean(options?.skipProjectList)
    try {
      // eslint-disable-next-line no-constant-condition -- drain one coalesced follow-up
      while (true) {
        let selected = projectRef.current
          ?? findCachedBusinessProject(projectsCacheRef.current, moduleId, workspaceRootPath, projectId)
        if (!skipProjectList || !selected) {
          const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
          setProjectsCache((current) => ({
            ...current,
            [businessProjectsCacheKey(moduleId, workspaceRootPath)]: projects,
          }))
          selected = projects.find((entry) => entry.projectId === projectId)
            ?? projects.find((entry) => entry.name === projectId)
            ?? null
        }
        setProject(selected)
        setProjectLoadState(selected ? 'ready' : 'missing')
        if (moduleId === 'tender' && selected) {
          const currentRuns = stageRunsRef.current
          const targets = stageFilter ?? (
            forceAll
              ? workflow.stages
              : workflow.stages.filter((stage) => {
                  const run = currentRuns[stage.id]
                  return !run || stageHasLiveWork(run) || stageHasResumableWork(run) || run.status === 'blocked'
                })
          )
          const next = { ...currentRuns }
          const touched: Array<[string, TenderStageRunResultDto]> = []
          for (const stage of targets) {
            try {
              // Prefer healed project parent; never re-send a deleted board pointer.
              const parentSessionId = currentRuns[stage.id]?.projectParentSessionId
                ?? currentRuns[stage.id]?.batchProgress?.parentSessionId
              const liveParentSessionId = parentSessionId && sessionMetaMapRef.current.has(parentSessionId)
                ? parentSessionId
                : undefined
              const run = await window.electronAPI.runTenderStage({
                action,
                workspaceRootPath,
                projectId: selected.projectId,
                stageId: stage.id,
                ...(action === 'resume' && liveParentSessionId ? { parentSessionId: liveParentSessionId } : {}),
              })
              next[stage.id] = run
              touched.push([stage.id, run])
            } catch {
              // keep previous snapshot for this stage
            }
          }
          stageRunsRef.current = next
          setStageRuns(next)
          setExpandedStageIds((current) => {
            const expanded = { ...current }
            for (const [stageId, run] of touched) {
              if ((stageHasLiveWork(run) || stageHasResumableWork(run)) && current[stageId] === undefined) {
                expanded[stageId] = true
              }
            }
            return expanded
          })
          setLastRefreshAt(Date.now())
          setError(null)
        } else {
          stageRunsRef.current = {}
          setStageRuns({})
          setLastRefreshAt(Date.now())
          setError(null)
        }

        const queued = refreshQueued.current
        refreshQueued.current = null
        if (!queued) return stageRunsRef.current
        action = queued.action
        stageFilter = queued.stages
        forceAll = false
        skipProjectList = true
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // Keep a cached project painted if list/status is only temporarily starved.
      const warm = projectRef.current
        ?? findCachedBusinessProject(projectsCacheRef.current, moduleId, workspaceRootPath, projectId)
      if (warm) {
        setProject(warm)
        setProjectLoadState('ready')
        toast.error(message)
        setError(null)
      } else {
        setError(message)
        setProjectLoadState('missing')
      }
      return stageRunsRef.current
    } finally {
      refreshInFlight.current = false
      setRefreshing(false)
    }
  }, [moduleId, projectId, setProjectsCache, workflow.stages, workspaceRootPath])

  // Snapshot inspect on open / project switch — do NOT clear live monitor
  // (host keeps resume polling while user is in chat).
  React.useEffect(() => {
    const warm = findCachedBusinessProject(projectsCacheRef.current, moduleId, workspaceRootPath, projectId)
    setProject(warm)
    setProjectLoadState(warm ? 'ready' : 'loading')
    stageRunsRef.current = {}
    setStageRuns({})
    void refresh({ force: true, action: 'status' })
    const handleChanged = () => void refresh({ force: true, action: 'status' })
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => window.removeEventListener('craft:business-projects-changed', handleChanged)
    // Intentionally depend on identity keys, not `refresh` (session meta must not re-mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- project/workspace identity only
  }, [moduleId, projectId, workspaceRootPath])

  // Apply background host ticks into the overview snapshot when mounted.
  React.useEffect(() => {
    if (moduleId !== 'tender') return
    const onTick = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; runs: TenderStageRunResultDto[] }>).detail
      if (!detail || detail.projectId !== projectId) return
      setStageRuns((current) => {
        const next = { ...current }
        for (const run of detail.runs) next[run.stageId] = run
        stageRunsRef.current = next
        return next
      })
      setLastRefreshAt(Date.now())
    }
    window.addEventListener('craft:tender-monitor-tick', onTick)
    return () => window.removeEventListener('craft:tender-monitor-tick', onTick)
  }, [moduleId, projectId])

  React.useEffect(() => {
    if (!monitoringActive) return
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [monitoringActive])

  // While live monitor is on, TenderLiveMonitorHost owns status/resume ticks
  // (and pushes craft:tender-monitor-tick). Extra session-event status IPC
  // previously stacked with the host and starved the main process.
  React.useEffect(() => {
    if (moduleId !== 'tender' || monitoringActive) return
    let debounceTimer: number | null = null
    const cleanup = window.electronAPI.onSessionEvent((event) => {
      if (
        event.type !== 'complete'
        && event.type !== 'error'
        && event.type !== 'session_status_changed'
        && event.type !== 'goal_state_changed'
      ) return
      if (!('sessionId' in event)) return
      const relatedStages = workflow.stages.filter((stage) => {
        const run = stageRunsRef.current[stage.id]
        if (!run) return false
        if (run.projectParentSessionId === event.sessionId) return true
        if (run.batchProgress?.parentSessionId === event.sessionId) return true
        return run.batchProgress?.tasks.some((task) => linkedSessionId(task) === event.sessionId) ?? false
      })
      if (relatedStages.length === 0) return
      if (debounceTimer != null) window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null
        void refresh({ action: 'status', stages: relatedStages, skipProjectList: true })
      }, 3_000)
    })
    return () => {
      if (debounceTimer != null) window.clearTimeout(debounceTimer)
      cleanup()
    }
  }, [moduleId, monitoringActive, refresh, workflow.stages])

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

  const handleRemoveProject = async () => {
    if (!project) return
    const confirmed = window.confirm(t('businessProjects.deleteProjectConfirm', { name: project.name }))
    if (!confirmed) return
    try {
      await window.electronAPI.unregisterBusinessProject({
        workspaceRootPath,
        module: moduleId,
        projectId: project.projectId,
      })
      window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
      toast.success(t('businessProjects.projectRemoved'))
      const listRoute = moduleId === 'tender'
        ? routes.view.tenderWorkspaces()
        : moduleId === 'delivery'
          ? routes.view.deliveryWorkspaces()
          : routes.view.investmentWorkspaces()
      navigate(listRoute)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleCompleteSetupStage = async () => {
    if (!project || moduleId !== 'tender') return
    setStartingStageId('project-setup')
    try {
      const completed = await window.electronAPI.runTenderStage({
        action: 'complete',
        workspaceRootPath,
        projectId: project.projectId,
        stageId: 'project-setup',
      })
      setStageRuns((current) => ({ ...current, 'project-setup': completed }))
      if (completed.status === 'complete') {
        toast.success('资料齐套已确认，可进入招标文件解析')
      } else {
        const summary = summarizeTenderStage(completed)
        toast.error(`尚不能确认齐套：${summary.missingLabel ?? summary.statusLabel}`)
      }
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleAcceptMethodologyReview = async () => {
    if (!project || moduleId !== 'tender') return
    setStartingStageId('planning-and-submission')
    try {
      const accepted = await acceptPlanningMethodologyReview(window.electronAPI.runTenderStage, {
        workspaceRootPath,
        projectId: project.projectId,
        stageId: 'planning-and-submission',
      })
      setStageRuns((current) => ({ ...current, 'planning-and-submission': accepted.result }))
      toast.success('已接受 4-A 施工策划报告，可继续进度/资源/现金流')
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const sendStageHandoff = async (
    parentSessionId: string,
    stage: BusinessWorkflowStage,
    stageRun?: TenderStageRunResultDto,
  ) => {
    if (!project || moduleId !== 'tender') return
    const draft = buildStageHandoffDraft(moduleId, project, stage, stageRun)
    try {
      await window.electronAPI.sendMessage(parentSessionId, draft, [], [], {})
    } catch (cause) {
      console.warn('[BusinessProjectOverview] failed to send stage handoff', cause)
      toast.message('主会话已切到本阶段；请在对话中发送阶段说明或点「进入阶段」重试交接')
    }
  }

  const handleOpenProjectParent = async () => {
    const openIfLive = (parentId: string | undefined): boolean => {
      if (!parentId) return false
      if (!sessionMetaMap.has(parentId)) return false
      openLinkedSession(parentId)
      toast.success('已打开项目主会话')
      return true
    }

    if (openIfLive(resolveProjectParentSessionId(stageRuns))) return

    // Old projects may still advertise a deleted pointer — status heals it.
    toast.message('主会话指针可能已失效，正在修复…')
    const next = await refresh({ force: true, action: 'status' })
    if (openIfLive(resolveProjectParentSessionId(next))) return

    toast.error('找不到存活的项目主会话。请从左侧打开当前 Todo 主会话，或对解析阶段使用「重置编排」后重试。')
  }

  const handleStartStage = async (stage: BusinessWorkflowStage) => {
    if (!project) return
    if (moduleId === 'tender' && stage.id === 'project-setup') {
      await handleCompleteSetupStage()
      return
    }
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

        const existingParentId = resolveProjectParentSessionId({
          ...stageRuns,
          [stage.id]: launch.result,
        }) ?? resolveStageParentSessionId(launch.result)

        if (existingParentId) {
          openLinkedSession(existingParentId)
          const prior = stageRuns[stage.id]
          const alreadyActive = Boolean(
            prior
            && resolveStageParentSessionId(prior) === existingParentId
            && (prior.status === 'running' || prior.status === 'complete'),
          )
          const advanced = await enterTenderStageInProjectParent(window.electronAPI.runTenderStage, {
            workspaceRootPath, projectId: project.projectId, stageId: stage.id,
          }, existingParentId)
          setStageRuns((current) => ({ ...current, [stage.id]: advanced.result }))
          setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
          setMonitoringActive(true)
          if (!alreadyActive) {
            await sendStageHandoff(existingParentId, stage, advanced.result)
          }
          const progress = advanced.result.batchProgress
          toast.success(
            progress
              ? `已在项目主会话派发：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
              : alreadyActive
                ? '已打开项目主会话'
                : '已在项目主会话进入本阶段',
          )
          return
        }
      }
      // First-ever project parent only — never per-stage.
      const parentSession = await openNewChat?.({
        name: project.name,
        workingDirectory: project.rootPath,
        businessContext: { module: moduleId, projectId: project.projectId, workflowId: project.workflowId, stageId: stage.id },
        input: buildBusinessTaskDraft(moduleId, project, stage, stageRun),
      })
      if (moduleId === 'tender' && parentSession) {
        const launch = await startAndAdvanceTenderStageLaunch(window.electronAPI.runTenderStage, {
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

  const handleEnterNextStage = async (fromStage: BusinessWorkflowStage) => {
    const index = workflow.stages.findIndex((entry) => entry.id === fromStage.id)
    const next = index >= 0 ? workflow.stages[index + 1] : undefined
    if (!next) {
      toast.message('已是最后阶段')
      return
    }
    if (stageHasLiveWork(stageRuns[fromStage.id])) {
      toast.error('当前阶段仍有运行中任务，请先等待完成或「停止派发」后再进入下一阶段')
      return
    }
    await handleStartStage(next)
  }

  const resolveLiveParentId = (run?: TenderStageRunResultDto): string | undefined => {
    const candidate = run?.projectParentSessionId
      ?? resolveStageParentSessionId(run)
      ?? resolveProjectParentSessionId(stageRuns)
    if (candidate && sessionMetaMap.has(candidate)) return candidate
    return undefined
  }

  const handleRetryBatches = async (stage: BusinessWorkflowStage, batchIds: string[]) => {
    const ids = [...new Set(batchIds.map((id) => id.trim()).filter(Boolean))]
    if (ids.length === 0) return
    const parentSessionId = resolveLiveParentId(stageRuns[stage.id])
    if (!parentSessionId) {
      toast.error('找不到存活的项目主会话，请先打开左侧主会话或点「打开项目主会话」修复指针')
      return
    }
    setStartingStageId(stage.id)
    setRetryingBatchId(ids.length === 1 ? ids[0]! : '__multi__')
    try {
      const result = await window.electronAPI.runTenderStage({
        action: 'advance',
        workspaceRootPath,
        projectId,
        stageId: stage.id,
        parentSessionId,
        retryBatchIds: ids,
        dispatchEnabled: true,
      })
      setStageRuns((current) => ({ ...current, [stage.id]: result }))
      setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
      setMonitoringActive(true)
      const progress = result.batchProgress
      toast.success(
        progress
          ? `已重试 ${ids.length} 个批次：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
          : `已重试 ${ids.length} 个批次`,
      )
    } catch (cause) {
      toast.error(`重试失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setStartingStageId(null)
      setRetryingBatchId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleRetryStage = async (stage: BusinessWorkflowStage) => {
    const run = stageRuns[stage.id]
    const failedIds = (run?.batchProgress?.tasks ?? [])
      .filter((task) => task.status === 'failed' || task.status === 'blocked')
      .map((task) => task.batchId)
    const invalidIds = (run?.batchProgress?.invalidBatches ?? []).map((batch) => batch.batchId)
    const retryIds = [...new Set([...failedIds, ...invalidIds])]
    if (retryIds.length > 0) {
      await handleRetryBatches(stage, retryIds)
      return
    }
    const parentSessionId = resolveLiveParentId(run)
    if (!parentSessionId) {
      await handleStartStage(stage)
      return
    }
    setStartingStageId(stage.id)
    try {
      await startTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, parentSessionId)
      const advanced = await advanceTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, parentSessionId)
      setStageRuns((current) => ({ ...current, [stage.id]: advanced.result }))
      setExpandedStageIds((current) => ({ ...current, [stage.id]: true }))
      const progress = advanced.result.batchProgress
      const inFlight = (progress?.runningBatches ?? 0) + (progress?.pendingBatches ?? 0)
      if (advanced.ok || inFlight > 0) {
        setMonitoringActive(true)
        toast.success(
          progress
            ? `已重新调度：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
            : '已重新调度失败批次',
        )
        return
      }
      const summary = summarizeTenderStage(advanced.result)
      toast.error(`重试失败：${summary.missingLabel ?? summary.statusLabel}`)
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleResumeStage = async (stage: BusinessWorkflowStage) => {
    const parentSessionId = resolveStageParentSessionId(stageRuns[stage.id])
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

  const handleAdvanceStage = async (stage: BusinessWorkflowStage) => {
    const parentSessionId = resolveStageParentSessionId(stageRuns[stage.id])
    if (!parentSessionId) {
      await handleStartStage(stage)
      return
    }
    setStartingStageId(stage.id)
    try {
      const advanced = await advanceTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, parentSessionId)
      setStageRuns((current) => ({ ...current, [stage.id]: advanced.result }))
      setMonitoringActive(true)
      const progress = advanced.result.batchProgress
      toast.success(
        progress
          ? `已派发下一步：运行 ${progress.runningBatches} · 排队 ${progress.pendingBatches}`
          : '已派发下一步',
      )
    } finally {
      setStartingStageId(null)
    }
  }

  const handleStopDispatch = async (stage: BusinessWorkflowStage) => {
    setStartingStageId(stage.id)
    try {
      const stopped = await setTenderStageDispatch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      }, false)
      setStageRuns((current) => ({ ...current, [stage.id]: stopped.result }))
      toast.message('已停止派发新子任务（进行中的会话不会自动杀掉）')
    } finally {
      setStartingStageId(null)
    }
  }

  const handleResetOrchestration = async (stage: BusinessWorkflowStage) => {
    if (!window.confirm(`重置「${stage.label}」编排状态？已验收的解析 MD / 能力包默认保留。`)) return
    setStartingStageId(stage.id)
    try {
      const reset = await resetTenderStageOrchestration(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      })
      setStageRuns((current) => ({ ...current, [stage.id]: reset.result }))
      toast.success('已重置本阶段编排队列')
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleOrganizeDeliverables = async (stage: BusinessWorkflowStage) => {
    if (!project || moduleId !== 'tender') return
    setStartingStageId(`${stage.id}::organize`)
    try {
      const parentSessionId = resolveProjectParentSessionId(stageRuns)
        ?? resolveStageParentSessionId(stageRuns[stage.id])
      const result = await window.electronAPI.runTenderStage({
        action: 'organize_deliverables',
        workspaceRootPath,
        projectId: project.projectId,
        stageId: stage.id,
        ...(parentSessionId ? { parentSessionId } : {}),
      })
      setStageRuns((current) => ({ ...current, [stage.id]: result }))
      const d = result.deliverables
      if (!d) {
        toast.message('已完成成果质检')
        return
      }
      toast.success(
        `成果质检：齐套 ${d.presentCount} · 缺失 ${d.missingCount} · 偏薄 ${d.thinCount}`
        + (d.published != null || d.healed != null
          ? `（整理发布 ${d.published ?? 0} · 补齐 ${d.healed ?? 0}）`
          : ''),
      )
    } catch (cause) {
      toast.error(`成果质检失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setStartingStageId(null)
    }
  }

  const openLinkedSession = (sessionId: string) => {
    navigate(routes.view.tenderWorkspaces(projectId, sessionId))
  }

  const monitoringBusy = monitoringActive && workflow.stages.some((stage) => (
    stageHasLiveWork(stageRuns[stage.id]) || stageHasResumableWork(stageRuns[stage.id])
  ))

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (projectLoadState === 'loading' || (refreshing && !project)) {
    return <div className="p-6 text-sm text-muted-foreground">正在加载项目监控…</div>
  }
  if (!project || projectLoadState === 'missing') {
    return <div className="p-6 text-sm text-muted-foreground">未找到该项目，请从左侧项目列表重新选择。</div>
  }

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
            <Button type="button" onClick={() => {
              if (moduleId === 'tender' && resolveProjectParentSessionId(stageRuns)) {
                void handleOpenProjectParent()
                return
              }
              void handleStartStage(workflow.stages[0]!)
            }}>
              <MessageSquarePlus className="size-4" />
              {moduleId === 'tender' && resolveProjectParentSessionId(stageRuns) ? '打开项目主会话' : '新建任务'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void handleRemoveProject()} title={t('businessProjects.deleteProject')}>
              <Trash2 className="size-4" />
              {t('businessProjects.deleteProject')}
            </Button>
          </div>
        </div>
      </header>

      {moduleId === 'tender' && Object.values(stageRuns).some((run) => run?.migratedFromLegacy) && (
        <div className="border-b bg-muted/40 px-6 py-3 text-xs text-muted-foreground">
          已合并为单一项目主会话（含旧版多阶段主会话选举）。旧阶段会话仍保留在侧栏（可只读回顾）；请在主会话继续。若子会话或批次队列异常，可对对应阶段使用「重置编排」（已验收的解析 MD 会保留）。
        </div>
      )}

      <section className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">流程监控</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              打开项目仅快照检查，不会自动调度。开启「恢复未完任务 / 下一步」后，切换到主会话对话也会继续后台跟踪与补位派发；失败批次可在任务行点「重试」。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('inline-flex items-center gap-1.5', monitoringActive && 'text-accent')}>
              <span className={cn('size-1.5 rounded-full', monitoringActive ? 'animate-pulse bg-accent' : 'bg-muted-foreground/40')} />
              {monitoringActive ? `监控中 ${LIVE_POLL_MS / 1000}s（含对话页）` : '监控未开启'}
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
              disabled={refreshing || startingStageId !== null || monitoringBusy}
              onClick={() => void handleResumeUnfinished()}
            >
              <PlayCircle className="size-3.5" />
              {startingStageId === '__resume__'
                ? '恢复中…'
                : monitoringBusy
                  ? '未完成任务正在进行中…'
                  : '恢复未完任务'}
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
            const live = stageHasLiveWork(run)
            const monitoredLive = monitoringActive && live
            const resumable = stageHasResumableWork(run)
            const completed = progress?.completedBatches ?? 0
            const total = progress?.batchCount ?? 0
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0
            const expanded = expandedStageIds[stage.id] ?? (live || resumable)
            const failed = progress?.failedBatches ?? 0
            const invalidActionable = progress ? actionableInvalidBatches(progress) : []
            const deliverables = run?.deliverables
            return (
              <div key={stage.id} className="py-3">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 w-6 text-sm text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{stage.label}</p>
                      {monitoredLive && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">监控中</span>}
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
                    {run?.substeps?.length ? (
                      <div className="mt-2 space-y-1.5 rounded-md border px-3 py-2 text-xs">
                        <p className="font-medium text-foreground">策划子步骤门禁</p>
                        {run.substeps.map((substep) => (
                          <div key={substep.id} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={cn(
                                'font-medium',
                                substep.status === 'complete' && 'text-success',
                                substep.status === 'ready' && 'text-accent',
                                substep.status === 'blocked' && 'text-destructive',
                                substep.status === 'pending' && 'text-muted-foreground',
                              )}>
                                {substep.label}
                                <span className="ml-2 font-normal text-muted-foreground">
                                  {substep.status === 'complete' ? '完成'
                                    : substep.status === 'ready' ? '待人审'
                                      : substep.status === 'blocked' ? '缺件'
                                        : '等待前置'}
                                </span>
                              </p>
                              {substep.missingItems.length > 0 && (
                                <p className="truncate text-muted-foreground" title={substep.missingItems.join('；')}>
                                  {substep.missingItems.join('；')}
                                </p>
                              )}
                            </div>
                            {substep.id === 'plan-methodology' && substep.status === 'ready' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={startingStageId !== null}
                                onClick={() => void handleAcceptMethodologyReview()}
                              >接受策划稿</Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
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
                    {deliverables && (
                      <div className="mt-2 rounded-md border px-3 py-2 text-[11px] text-muted-foreground">
                        <p className="font-medium text-foreground">阶段成果目录</p>
                        <p className="mt-0.5">
                          齐套 {deliverables.presentCount}
                          {deliverables.missingCount > 0 ? ` · 缺失 ${deliverables.missingCount}` : ''}
                          {deliverables.thinCount > 0 ? ` · 偏薄 ${deliverables.thinCount}` : ''}
                          {deliverables.publishedToOfficial ? ' · 已镜像正式输出' : ' · 正式输出未齐'}
                        </p>
                        {deliverables.summaryPath && (
                          <p className="mt-0.5 truncate" title={deliverables.summaryPath}>摘要 {deliverables.summaryPath}</p>
                        )}
                      </div>
                    )}
                    {invalidActionable.length > 0 ? (
                      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-destructive">报告未通过验收（{invalidActionable.length} 批）</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0"
                            disabled={startingStageId !== null || live}
                            onClick={() => void handleRetryBatches(
                              stage,
                              invalidActionable.map((batch) => batch.batchId),
                            )}
                          >
                            {startingStageId === stage.id && retryingBatchId === '__multi__'
                              ? '重试中…'
                              : '重试未通过批次'}
                          </Button>
                        </div>
                        <ul className="mt-1 space-y-1 text-muted-foreground">
                          {invalidActionable.slice(0, 4).map((batch) => (
                            <li key={batch.batchId} className="flex items-start justify-between gap-2 min-w-0">
                              <div className="min-w-0">
                                <span className="font-mono text-[11px]">{batch.batchId}</span>
                                {batch.errors.slice(0, 2).map((err, i) => (
                                  <p key={i} className="truncate" title={err}>· {err}</p>
                                ))}
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 shrink-0 px-2"
                                disabled={startingStageId !== null || live}
                                onClick={() => void handleRetryBatches(stage, [batch.batchId])}
                              >
                                {retryingBatchId === batch.batchId ? '…' : '重试'}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {(progress?.validationWarningCount ?? 0) > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {progress!.validationWarningCount} 条格式归一化提示已记录（非阻塞，供人工复核）
                      </p>
                    )}
                    {progress?.skippedItems?.length ? (
                      <p className="mt-1.5 text-[11px] text-muted-foreground" title={progress.skippedItems.map((item) => `${item.code}: ${item.reason}`).join('\n')}>
                        {progress.skippedItems.length} 条对账行不进入组价（汇总行/人造组合）：{progress.skippedItems.slice(0, 3).map((item) => item.code).join('、')}{progress.skippedItems.length > 3 ? '…' : ''}
                      </p>
                    ) : null}
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
                              const midFlight = taskIsMidFlight(task)
                              const duration = midFlight || task.status === 'running'
                                ? formatElapsed(task.startedAt, nowMs)
                                : task.status === 'complete' && task.startedAt && task.completedAt
                                  ? formatElapsed(task.startedAt, Date.parse(task.completedAt))
                                  : null
                              const sessionId = linkedSessionId(task)
                              const idleLinked = Boolean(sessionId) && task.linkedIsProcessing === false
                              const canRetryTask = (task.status === 'failed' || task.status === 'blocked') && !midFlight
                              return (
                                <div key={task.batchId} className="flex items-start gap-3 py-2">
                                  <span className={cn(
                                    'w-12 shrink-0 font-medium',
                                    task.status === 'complete' && 'text-success',
                                    (midFlight || task.status === 'running') && 'text-accent',
                                    task.status === 'pending' && !midFlight && 'text-muted-foreground',
                                    (task.status === 'failed' || task.status === 'blocked') && !midFlight && 'text-destructive',
                                  )}>{taskStatusLabel(task.status, midFlight)}</span>
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
                                    <p className="truncate text-muted-foreground" title={midFlight ? undefined : (task.error ?? task.reportPath)}>
                                      {(midFlight ? null : task.error)
                                        ?? [
                                          sessionId ? (idleLinked ? `左侧空闲 · ${sessionId}` : `会话 ${sessionId}`) : null,
                                          task.linkedSessionStatus ? `状态 ${task.linkedSessionStatus}` : null,
                                          `尝试 ${task.attemptCount}`,
                                          duration ? (midFlight ? `已运行 ${duration}` : `耗时 ${duration}`) : null,
                                          task.updatedAt ? `更新 ${formatClock(task.updatedAt)}` : null,
                                        ].filter(Boolean).join(' · ')}
                                    </p>
                                  </div>
                                  {canRetryTask && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 shrink-0"
                                      disabled={startingStageId !== null}
                                      onClick={() => void handleRetryBatches(stage, [task.batchId])}
                                    >
                                      {retryingBatchId === task.batchId ? '重试中…' : '重试'}
                                    </Button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {stage.id === 'project-setup' ? (
                      run?.status === 'complete' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const parentId = resolveProjectParentSessionId(stageRuns)
                              ?? resolveStageParentSessionId(run)
                            if (parentId) {
                              openLinkedSession(parentId)
                              toast.success('资料登记完成，已打开项目主会话')
                              return
                            }
                            toast.message(`资料登记完成（已登记 ${project?.inputPaths.length ?? 0} 份），可在下方「项目资料」查看`)
                          }}
                        >资料登记完成，点击可查看结果</Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={startingStageId !== null}
                          onClick={() => void handleCompleteSetupStage()}
                        >{startingStageId === stage.id ? '确认中…' : '资料齐套，进入解析'}</Button>
                      )
                    ) : (
                      <>
                        {resumable && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={startingStageId !== null || live}
                            onClick={() => void handleAdvanceStage(stage)}
                          >{startingStageId === stage.id
                              ? '派发中…'
                              : live
                                ? '正在进行，请稍后…'
                                : '下一步'}</Button>
                        )}
                        {resumable && !failed && !live && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            onClick={() => void handleResumeStage(stage)}
                          >{startingStageId === stage.id ? '恢复中…' : '恢复本阶段'}</Button>
                        )}
                        {(live || resumable) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            onClick={() => void handleStopDispatch(stage)}
                          >停止派发</Button>
                        )}
                        {(stage.id === 'tender-document-analysis' || stage.id === 'boq-five-step-pricing') && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            title="检查主会话/子会话成果路径，缺的补到正式输出并刷新成果目录"
                            onClick={() => void handleOrganizeDeliverables(stage)}
                          >{startingStageId === `${stage.id}::organize` ? '质检中…' : '成果质检并整理'}</Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={startingStageId !== null || (live && !failed)}
                          title={live && !failed
                            ? '阶段有运行中任务 — 请稍候或点「停止派发」'
                            : run?.status === 'blocked' && !resumable ? summary?.missingLabel : undefined}
                          onClick={() => void (failed ? handleRetryStage(stage) : handleStartStage(stage))}
                        >{startingStageId === stage.id
                            ? '处理中…'
                            : failed
                              ? '重试失败批次'
                              : resolveProjectParentSessionId(stageRuns) || resolveStageParentSessionId(run)
                                ? '打开项目主会话'
                                : '进入阶段'}</Button>
                        {run?.status === 'complete' && index < workflow.stages.length - 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null || live}
                            title={live ? '请先等待本阶段运行中任务结束' : undefined}
                            onClick={() => void handleEnterNextStage(stage)}
                          >进入下一阶段</Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={startingStageId !== null}
                          onClick={() => void handleResetOrchestration(stage)}
                        >重置编排</Button>
                      </>
                    )}
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

function taskStatusLabel(status: StageTask['status'], midFlight = false): string {
  if (midFlight && status !== 'running' && status !== 'complete') return '重试中'
  return {
    pending: '排队',
    running: '运行',
    complete: '完成',
    failed: '失败',
    blocked: '阻塞',
  }[status]
}
