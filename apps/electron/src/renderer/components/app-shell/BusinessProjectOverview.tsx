import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { FilePlus2, FolderOpen, MessageSquarePlus, RefreshCw, PlayCircle, SearchCheck, Square, Trash2, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { i18n } from '@craft-agent/shared/i18n'
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
  forcePassTenderStage,
  formatTenderMissingItem,
  planningSubstepLabel,
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

function stageCanForcePass(run?: TenderStageRunResultDto): boolean {
  if (!run) return false
  if (run.status === 'blocked') return true
  if ((run.missingItems?.length ?? 0) > 0) return true
  return Boolean(run.substeps?.some((substep) => (
    substep.status === 'blocked' || substep.missingItems.length > 0
  )))
}

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
  if (run.batchProgress.dispatchEnabled === false) return false
  return run.batchProgress.pendingBatches > 0
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

function taskIsMidFlight(task: StageTask, liveProcessing?: boolean): boolean {
  if (task.status === 'complete') return false
  if (liveProcessing === true) return true
  if (liveProcessing === false && task.status !== 'running') return false
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
  if (hours > 0) return i18n.t('businessProjects.durationHoursMinutes', { hours, minutes })
  if (minutes > 0) {
    return i18n.t('businessProjects.durationMinutesSeconds', {
      minutes,
      seconds: seconds.toString().padStart(2, '0'),
    })
  }
  return i18n.t('businessProjects.durationSeconds', { seconds })
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
  const monitoringDispatchPaused = Boolean(monitoringActive && liveMonitor?.dispatchPaused)
  const setMonitoringActive = React.useCallback((active: boolean, options?: { dispatchPaused?: boolean }) => {
    if (moduleId !== 'tender') return
    setLiveMonitor(active
      ? {
          moduleId: 'tender',
          workspaceRootPath,
          projectId,
          active: true,
          dispatchPaused: options?.dispatchPaused ?? false,
          lastTickAt: Date.now(),
        }
      : (current) => (
        current?.projectId === projectId
          ? { ...current, active: false, dispatchPaused: false, lastTickAt: Date.now() }
          : current
      ))
  }, [moduleId, projectId, setLiveMonitor, workspaceRootPath])
  const setMonitoringDispatchPaused = React.useCallback((paused: boolean) => {
    if (moduleId !== 'tender') return
    setLiveMonitor((current) => {
      if (!current || current.projectId !== projectId) {
        return {
          moduleId: 'tender',
          workspaceRootPath,
          projectId,
          active: true,
          dispatchPaused: paused,
          lastTickAt: Date.now(),
        }
      }
      return { ...current, active: true, dispatchPaused: paused, lastTickAt: Date.now() }
    })
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
              // Prefer a left-rail live parent; for resume, still send a candidate and
              // let the server heal/elect if the pointer is stale.
              const liveParentSessionId = parentSessionId && sessionMetaMapRef.current.has(parentSessionId)
                ? parentSessionId
                : (action === 'resume' ? parentSessionId : undefined)
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
    toast.success(t('businessProjects.toastInspected'))
  }

  const handleResumeUnfinished = async () => {
    if (!project) return
    setStartingStageId('__resume__')
    try {
      const inspected = await refresh({ force: true, action: 'status' })
      const targets = workflow.stages.filter((stage) => stageHasResumableWork(inspected[stage.id]))
      if (targets.length === 0) {
        toast.message(t('businessProjects.toastNothingToResume'))
        return
      }
      for (const stage of targets) {
        const enabled = await setTenderStageDispatch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId, stageId: stage.id,
        }, true)
        setStageRuns((current) => ({ ...current, [stage.id]: enabled.result }))
      }
      await refresh({ force: true, action: 'resume', stages: targets })
      setMonitoringActive(true, { dispatchPaused: false })
      toast.success(t('businessProjects.toastResumedUnfinished'))
    } finally {
      setStartingStageId(null)
    }
  }

  const handlePauseMonitorDispatch = async () => {
    if (!project) return
    setStartingStageId('__pause__')
    try {
      const targets = workflow.stages.filter((stage) => {
        const run = stageRuns[stage.id]
        return Boolean(run?.batchProgress)
      })
      for (const stage of targets) {
        const stopped = await setTenderStageDispatch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId, stageId: stage.id,
        }, false)
        setStageRuns((current) => ({ ...current, [stage.id]: stopped.result }))
      }
      setMonitoringDispatchPaused(true)
      await refresh({ force: true, action: 'status', stages: targets.length > 0 ? targets : undefined })
      toast.message(t('businessProjects.toastPausedFill'))
    } finally {
      setStartingStageId(null)
    }
  }

  const handleResumeMonitorDispatch = async () => {
    if (!project) return
    setStartingStageId('__resume_dispatch__')
    try {
      const inspected = await refresh({ force: true, action: 'status' })
      const targets = workflow.stages.filter((stage) => stageHasResumableWork(inspected[stage.id]) || stageHasLiveWork(inspected[stage.id]))
      for (const stage of (targets.length > 0 ? targets : workflow.stages)) {
        if (!inspected[stage.id]?.batchProgress) continue
        const enabled = await setTenderStageDispatch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId, stageId: stage.id,
        }, true)
        setStageRuns((current) => ({ ...current, [stage.id]: enabled.result }))
      }
      setMonitoringDispatchPaused(false)
      if (targets.length > 0) {
        await refresh({ force: true, action: 'resume', stages: targets })
      }
      toast.success(t('businessProjects.toastResumedFill'))
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
    toast.success(t('businessProjects.toastFilesRegistered', { count: updated.inputPaths.length }))
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
        toast.success(t('businessProjects.toastSetupComplete'))
      } else {
        const summary = summarizeTenderStage(completed)
        toast.error(t('businessProjects.toastSetupBlocked', { detail: summary.missingLabel ?? summary.statusLabel }))
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
      toast.success(t('businessProjects.toastMethodologyAccepted'))
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
      toast.message(t('businessProjects.toastHandoffFallback'))
    }
  }

  const handleOpenProjectParent = async () => {
    const openIfLive = (parentId: string | undefined): boolean => {
      if (!parentId) return false
      if (!sessionMetaMap.has(parentId)) return false
      openLinkedSession(parentId)
      toast.success(t('businessProjects.toastOpenedParent'))
      return true
    }

    if (openIfLive(resolveProjectParentSessionId(stageRuns))) return

    // Old projects may still advertise a deleted pointer — status heals it.
    toast.message(t('businessProjects.toastHealingParent'))
    const next = await refresh({ force: true, action: 'status' })
    if (openIfLive(resolveProjectParentSessionId(next))) return

    toast.error(t('businessProjects.toastParentMissing'))
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
          toast.error(t('businessProjects.toastStageNotReady', { detail: summary.missingLabel ?? summary.statusLabel }))
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
              ? t('businessProjects.toastDispatched', { running: progress.runningBatches, pending: progress.pendingBatches })
              : alreadyActive
                ? t('businessProjects.toastOpenedParent')
                : t('businessProjects.toastEnteredStage'),
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
          toast.error(t('businessProjects.toastStageStartFailed', { detail: summary.missingLabel ?? summary.statusLabel }))
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
      toast.message(t('businessProjects.toastLastStage'))
      return
    }
    if (stageHasLiveWork(stageRuns[fromStage.id])) {
      toast.error(t('businessProjects.toastWaitBeforeNext'))
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
      ?? resolveStageParentSessionId(stageRuns[stage.id])
      ?? resolveProjectParentSessionId(stageRuns)
    if (!parentSessionId) {
      toast.error(t('businessProjects.toastNeedParent'))
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
          ? t('businessProjects.toastRetriedBatches', { count: ids.length, running: progress.runningBatches, pending: progress.pendingBatches })
          : t('businessProjects.toastRetriedBatchesSimple', { count: ids.length }),
      )
    } catch (cause) {
      toast.error(t('businessProjects.toastResumeFailed', { detail: cause instanceof Error ? cause.message : String(cause) }))
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
            ? t('businessProjects.toastRescheduled', { running: progress.runningBatches, pending: progress.pendingBatches })
            : t('businessProjects.toastRescheduledSimple'),
        )
        return
      }
      const summary = summarizeTenderStage(advanced.result)
      toast.error(t('businessProjects.toastResumeFailed', { detail: summary.missingLabel ?? summary.statusLabel }))
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
          ? t('businessProjects.toastResumed', { running: progress.runningBatches, pending: progress.pendingBatches })
          : t('businessProjects.toastResumedSimple'),
      )
    } finally {
      setStartingStageId(null)
    }
  }

  const handleAdvanceStage = async (stage: BusinessWorkflowStage) => {
    const run = stageRuns[stage.id]
    const failedIds = (run?.batchProgress?.tasks ?? [])
      .filter((task) => task.status === 'failed' || task.status === 'blocked')
      .map((task) => task.batchId)
    if (failedIds.length > 0) {
      await handleRetryBatches(stage, failedIds)
      return
    }
    const parentSessionId = resolveStageParentSessionId(run)
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
          ? t('businessProjects.toastAdvanced', { running: progress.runningBatches, pending: progress.pendingBatches })
          : t('businessProjects.toastAdvancedSimple'),
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
      setMonitoringDispatchPaused(true)
      toast.message(t('businessProjects.toastStoppedDispatch'))
    } finally {
      setStartingStageId(null)
    }
  }

  const handleResetOrchestration = async (stage: BusinessWorkflowStage) => {
    if (!window.confirm(t('businessProjects.confirmResetOrchestration', { stage: t(stage.labelKey) }))) return
    setStartingStageId(stage.id)
    try {
      const reset = await resetTenderStageOrchestration(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId, stageId: stage.id,
      })
      setStageRuns((current) => ({ ...current, [stage.id]: reset.result }))
      toast.success(t('businessProjects.toastResetOrchestration'))
    } finally {
      setStartingStageId(null)
      void refresh({ force: true, action: 'status' })
    }
  }

  const handleForcePass = async (stage: BusinessWorkflowStage) => {
    if (!window.confirm(t('businessProjects.forcePassConfirm'))) return
    setStartingStageId(`${stage.id}::force_pass`)
    try {
      const parentSessionId = resolveProjectParentSessionId(stageRuns)
        ?? resolveStageParentSessionId(stageRuns[stage.id])
      const passed = await forcePassTenderStage(window.electronAPI.runTenderStage, {
        workspaceRootPath,
        projectId,
        stageId: stage.id,
        ...(parentSessionId ? { parentSessionId } : {}),
      })
      setStageRuns((current) => ({ ...current, [stage.id]: passed.result }))
      if (passed.ok) {
        setMonitoringActive(true)
        toast.success(
          passed.result.userForcePass?.waivedItems.includes('project-characteristics:evidence-gap')
            ? t('businessProjects.toastForcePassDiligence')
            : passed.result.status === 'running'
              ? t('businessProjects.toastForcePassContinue')
              : t('businessProjects.toastForcePassGeneric'),
        )
      } else {
        const summary = summarizeTenderStage(passed.result)
        toast.error(t('businessProjects.toastForcePassStillBlocked', { detail: summary.missingLabel ?? summary.statusLabel }))
      }
    } catch (cause) {
      toast.error(t('businessProjects.toastForcePassFailed', { detail: cause instanceof Error ? cause.message : String(cause) }))
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
        toast.message(t('businessProjects.toastOrganizeDone'))
        return
      }
      toast.success(
        t('businessProjects.toastOrganizeSummary', { present: d.presentCount, missing: d.missingCount, thin: d.thinCount })
        + (d.published != null || d.healed != null
          ? t('businessProjects.toastOrganizeHeal', { published: d.published ?? 0, healed: d.healed ?? 0 })
          : ''),
      )
    } catch (cause) {
      toast.error(t('businessProjects.toastOrganizeFailed', { detail: cause instanceof Error ? cause.message : String(cause) }))
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
  const forcePassTarget = moduleId === 'tender'
    ? workflow.stages.find((stage) => stage.id !== 'project-setup' && stageCanForcePass(stageRuns[stage.id]))
    : undefined

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (projectLoadState === 'loading' || (refreshing && !project)) {
    return <div className="p-6 text-sm text-muted-foreground">{t('businessProjects.loadingMonitor')}</div>
  }
  if (!project || projectLoadState === 'missing') {
    return <div className="p-6 text-sm text-muted-foreground">{t('businessProjects.projectNotFound')}</div>
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
            <Button type="button" variant="outline" onClick={() => void handleAddInputs()}><FilePlus2 className="size-4" />{t('businessProjects.addFiles')}</Button>
            <Button type="button" onClick={() => {
              if (moduleId === 'tender' && resolveProjectParentSessionId(stageRuns)) {
                void handleOpenProjectParent()
                return
              }
              void handleStartStage(workflow.stages[0]!)
            }}>
              <MessageSquarePlus className="size-4" />
              {moduleId === 'tender' && resolveProjectParentSessionId(stageRuns) ? t('businessProjects.openProjectParent') : t('businessProjects.newTask')}
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
          {t('businessProjects.legacyMergedNotice')}
        </div>
      )}

      <section className="border-b px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('businessProjects.monitorTitle')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('businessProjects.monitorHelp')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('inline-flex items-center gap-1.5', monitoringActive && !monitoringDispatchPaused && 'text-accent')}>
              <span className={cn(
                'size-1.5 rounded-full',
                monitoringActive && !monitoringDispatchPaused
                  ? 'animate-pulse bg-accent'
                  : monitoringActive && monitoringDispatchPaused
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/40',
              )} />
              {monitoringActive
                ? (monitoringDispatchPaused
                  ? t('businessProjects.monitorPaused')
                  : t('businessProjects.monitorLive', { seconds: LIVE_POLL_MS / 1000 }))
                : t('businessProjects.monitorOff')}
            </span>
            <span title={lastRefreshAt ? new Date(lastRefreshAt).toLocaleString() : undefined}>
              {t('businessProjects.checkedAt', { time: lastRefreshAt ? formatClock(new Date(lastRefreshAt).toISOString()) : '—' })}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void handleInspect()}>
              <SearchCheck className={cn('size-3.5', refreshing && !monitoringActive && 'animate-pulse')} />
              {t('businessProjects.inspect')}
            </Button>
            {moduleId === 'tender' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startingStageId !== null || !forcePassTarget}
                title={forcePassTarget
                  ? `${t('businessProjects.forcePass')} · ${t(forcePassTarget.labelKey)}`
                  : t('businessProjects.forcePassUnavailable')}
                onClick={() => {
                  if (!forcePassTarget) return
                  void handleForcePass(forcePassTarget)
                }}
              >
                <Unlock className="size-3.5" />
                {t('businessProjects.forcePass')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={refreshing || startingStageId !== null || monitoringBusy}
              onClick={() => void handleResumeUnfinished()}
            >
              <PlayCircle className="size-3.5" />
              {startingStageId === '__resume__'
                ? t('businessProjects.resuming')
                : monitoringBusy
                  ? t('businessProjects.resumeBusy')
                  : t('businessProjects.resumeUnfinished')}
            </Button>
            {monitoringActive && !monitoringDispatchPaused ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startingStageId !== null}
                onClick={() => void handlePauseMonitorDispatch()}
              >
                <Square className="size-3.5" />
                {startingStageId === '__pause__' ? t('businessProjects.pausing') : t('businessProjects.pauseFill')}
              </Button>
            ) : null}
            {monitoringActive && monitoringDispatchPaused ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={startingStageId !== null}
                onClick={() => void handleResumeMonitorDispatch()}
              >
                <PlayCircle className="size-3.5" />
                {startingStageId === '__resume_dispatch__' ? t('businessProjects.resuming') : t('businessProjects.resumeFill')}
              </Button>
            ) : null}
            {monitoringActive ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setMonitoringActive(false)}>
                <Square className="size-3.5" />
                {t('businessProjects.stopMonitor')}
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={refreshing} onClick={() => void refresh({ force: true, action: 'status' })}>
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
                {t('businessProjects.refreshSnapshot')}
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
                      <p className="text-sm font-medium">{t(stage.labelKey)}</p>
                      {monitoredLive && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{t('businessProjects.monitoring')}</span>}
                      {!live && resumable && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t('businessProjects.hasUnfinished')}</span>
                      )}
                      {run?.userForcePass && run.userForcePass.waivedItems.length > 0 && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t('businessProjects.forcePassBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t(stage.hintKey)}</p>
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
                        <p className="font-medium text-foreground">{t('businessProjects.planningGates')}</p>
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
                                {planningSubstepLabel(substep.id)}
                                <span className="ml-2 font-normal text-muted-foreground">
                                  {substep.status === 'complete' ? t('businessProjects.substepComplete')
                                    : substep.status === 'ready' ? t('businessProjects.substepAwaitingReview')
                                      : substep.status === 'blocked' ? t('businessProjects.substepMissingItems')
                                        : t('businessProjects.substepWaitingPrior')}
                                </span>
                              </p>
                              {substep.missingItems.length > 0 && (
                                <p className="truncate text-muted-foreground" title={substep.missingItems.map(formatTenderMissingItem).join(t('businessProjects.missingJoin'))}>
                                  {substep.missingItems.map(formatTenderMissingItem).join(t('businessProjects.missingJoin'))}
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
                              >{t('businessProjects.acceptMethodology')}</Button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {progress && total > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{t('businessProjects.batchProgress', { completed, total, percent })}</span>
                          <span>
                            {t('businessProjects.batchRunningQueued', { running: progress.runningBatches, pending: progress.pendingBatches })}
                            {failed > 0 ? t('businessProjects.batchFailedSuffix', { count: failed }) : ''}
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
                        <p className="font-medium text-foreground">{t('businessProjects.deliverablesTitle')}</p>
                        <p className="mt-0.5">
                          {t('businessProjects.deliverablesPresent', { count: deliverables.presentCount })}
                          {deliverables.missingCount > 0 ? t('businessProjects.deliverablesMissing', { count: deliverables.missingCount }) : ''}
                          {deliverables.thinCount > 0 ? t('businessProjects.deliverablesThin', { count: deliverables.thinCount }) : ''}
                          {deliverables.publishedToOfficial ? t('businessProjects.deliverablesMirrored') : t('businessProjects.deliverablesNotReady')}
                        </p>
                        {deliverables.summaryPath && (
                          <p className="mt-0.5 truncate" title={deliverables.summaryPath}>{t('businessProjects.deliverablesSummary', { path: deliverables.summaryPath })}</p>
                        )}
                      </div>
                    )}
                    {invalidActionable.length > 0 ? (
                      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium text-destructive">{t('businessProjects.invalidReports', { count: invalidActionable.length })}</p>
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
                              ? t('businessProjects.retrying')
                              : t('businessProjects.retryInvalidBatches')}
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
                                {retryingBatchId === batch.batchId ? '…' : t('common.retry')}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {(progress?.validationWarningCount ?? 0) > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {t('businessProjects.validationWarnings', { count: progress!.validationWarningCount })}
                      </p>
                    )}
                    {progress?.skippedItems?.length ? (
                      <p className="mt-1.5 text-[11px] text-muted-foreground" title={progress.skippedItems.map((item) => `${item.code}: ${item.reason}`).join('\n')}>
                        {t('businessProjects.skippedItems', {
                          count: progress.skippedItems.length,
                          codes: `${progress.skippedItems.slice(0, 3).map((item) => item.code).join(', ')}${progress.skippedItems.length > 3 ? '…' : ''}`,
                        })}
                      </p>
                    ) : null}
                    {progress?.tasks.length ? (
                      <div className="mt-2 text-xs">
                        <button
                          type="button"
                          className="cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={() => setExpandedStageIds((current) => ({ ...current, [stage.id]: !expanded }))}
                        >
                          {expanded ? t('businessProjects.collapseBatches') : t('businessProjects.expandBatches')}（{progress.tasks.length}）
                        </button>
                        {expanded && (
                          <div className="mt-2 max-h-80 overflow-auto divide-y border-y">
                            {progress.tasks.map((task) => {
                              const sessionId = linkedSessionId(task)
                              const meta = sessionId ? sessionMetaMap.get(sessionId) : undefined
                              const liveProcessing = meta?.isProcessing
                              const sessionMissing = Boolean(sessionId) && !meta
                              const midFlight = taskIsMidFlight(task, liveProcessing)
                              const duration = midFlight || task.status === 'running'
                                ? formatElapsed(task.startedAt, nowMs)
                                : task.status === 'complete' && task.startedAt && task.completedAt
                                  ? formatElapsed(task.startedAt, Date.parse(task.completedAt))
                                  : null
                              const idleLinked = Boolean(sessionId) && !sessionMissing && (
                                liveProcessing === false
                                || (liveProcessing === undefined && task.linkedIsProcessing === false)
                              )
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
                                    {sessionId && !sessionMissing ? (
                                      <button
                                        type="button"
                                        className="block w-full truncate text-left text-foreground hover:text-primary hover:underline"
                                        title={t('businessProjects.openLinkedSession', { id: sessionId })}
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
                                          sessionMissing ? t('businessProjects.sessionGone', { id: sessionId }) : null,
                                          sessionId && !sessionMissing
                                            ? (idleLinked
                                              ? t('businessProjects.sessionIdle', { id: sessionId })
                                              : `${t('businessProjects.sessionLive', { id: sessionId })}${liveProcessing ? t('businessProjects.sessionLiveRunning') : ''}`)
                                            : null,
                                          (meta?.sessionStatus ?? task.linkedSessionStatus)
                                            ? t('businessProjects.sessionStatus', { status: meta?.sessionStatus ?? task.linkedSessionStatus })
                                            : null,
                                          t('businessProjects.attemptCount', { count: task.attemptCount }),
                                          duration ? (midFlight ? t('businessProjects.elapsedRunning', { duration }) : t('businessProjects.elapsedDone', { duration })) : null,
                                          task.updatedAt ? t('businessProjects.updatedAt', { time: formatClock(task.updatedAt) }) : null,
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
                                      {retryingBatchId === task.batchId ? t('businessProjects.retrying') : t('common.retry')}
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
                              toast.success(t('businessProjects.setupDoneOpen'))
                              return
                            }
                            toast.message(t('businessProjects.setupDoneToast', { count: project?.inputPaths.length ?? 0 }))
                          }}
                        >{t('businessProjects.setupDoneButton')}</Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={startingStageId !== null}
                          onClick={() => void handleCompleteSetupStage()}
                        >{startingStageId === stage.id ? t('businessProjects.confirming') : t('businessProjects.confirmComplete')}</Button>
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
                              ? t('businessProjects.dispatching')
                              : live
                                ? t('businessProjects.pleaseWait')
                                : t('businessProjects.nextStep')}</Button>
                        )}
                        {resumable && !failed && !live && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            onClick={() => void handleResumeStage(stage)}
                          >{startingStageId === stage.id ? t('businessProjects.resuming') : t('businessProjects.resumeStage')}</Button>
                        )}
                        {(live || resumable) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            onClick={() => void handleStopDispatch(stage)}
                          >{t('businessProjects.stopDispatch')}</Button>
                        )}
                        {(stage.id === 'tender-document-analysis'
                          || stage.id === 'boq-five-step-pricing') && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null}
                            title={t('businessProjects.organizeTitle')}
                            onClick={() => void handleOrganizeDeliverables(stage)}
                          >{startingStageId === `${stage.id}::organize` ? t('businessProjects.organizing') : t('businessProjects.organizeDeliverables')}</Button>
                        )}
                        {stageCanForcePass(run) && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={startingStageId !== null}
                            title={t('businessProjects.forcePassConfirm')}
                            onClick={() => void handleForcePass(stage)}
                          >{startingStageId === `${stage.id}::force_pass`
                              ? t('businessProjects.forcePassing')
                              : t('businessProjects.forcePass')}</Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={startingStageId !== null || (live && !failed)}
                          title={live && !failed
                            ? t('businessProjects.startBusyTitle')
                            : run?.status === 'blocked' && !resumable ? summary?.missingLabel : undefined}
                          onClick={() => void (failed ? handleRetryStage(stage) : handleStartStage(stage))}
                        >{startingStageId === stage.id
                            ? t('businessProjects.processing')
                            : failed
                              ? t('businessProjects.retryFailedBatches')
                              : resolveProjectParentSessionId(stageRuns) || resolveStageParentSessionId(run)
                                ? t('businessProjects.openProjectParent')
                                : t('businessProjects.enterStage')}</Button>
                        {run?.status === 'complete' && index < workflow.stages.length - 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={startingStageId !== null || live}
                            title={live ? t('businessProjects.waitBeforeNext') : undefined}
                            onClick={() => void handleEnterNextStage(stage)}
                          >{t('businessProjects.enterNextStage')}</Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={startingStageId !== null}
                          onClick={() => void handleResetOrchestration(stage)}
                        >{t('businessProjects.resetOrchestration')}</Button>
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
          <h2 className="text-sm font-semibold">{t('businessProjects.projectFiles')}</h2>
          <span className="text-xs text-muted-foreground">{t('businessProjects.projectFilesHint')}</span>
        </div>
        <div className="mt-3 divide-y">
          {project.inputPaths.length === 0 && <p className="py-6 text-sm text-muted-foreground">{t('businessProjects.noFilesYet')}</p>}
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
  if (midFlight && status !== 'running' && status !== 'complete') {
    return i18n.t('businessProjects.taskRetrying')
  }
  return {
    pending: i18n.t('businessProjects.taskPending'),
    running: i18n.t('businessProjects.taskRunning'),
    complete: i18n.t('businessProjects.taskComplete'),
    failed: i18n.t('businessProjects.taskFailed'),
    blocked: i18n.t('businessProjects.taskBlocked'),
  }[status]
}
