import * as React from 'react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { tenderLiveMonitorAtom } from '@/atoms/tender-monitor'
import { useAppShellContext } from '@/context/AppShellContext'
import { isTenderNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { getBusinessWorkflow } from '@/pages/business-workflows'

/** Slower than before — status/resume on every stage was starving the main process. */
const LIVE_POLL_MS = 45_000

function stageHasLiveWork(run?: TenderStageRunResultDto): boolean {
  if (!run?.batchProgress) return false
  return run.batchProgress.runningBatches > 0
    || run.batchProgress.tasks.some((task) => (
      task.status === 'running'
      || (task.linkedIsProcessing === true && task.status !== 'complete')
    ))
}

/** Fill-up work only — failed batches wait for explicit 重试, not endless resume polls. */
function stageNeedsFillUp(run?: TenderStageRunResultDto): boolean {
  if (!run?.batchProgress) return false
  return run.batchProgress.pendingBatches > 0
    || run.batchProgress.runningBatches > 0
}

function stageNeedsStatus(run?: TenderStageRunResultDto): boolean {
  if (!run) return true
  if (stageNeedsFillUp(run) || stageHasLiveWork(run)) return true
  return run.status === 'blocked' || run.status === 'running'
}

/**
 * Keeps tender stage fill-up alive even when BusinessProjectOverview is
 * unmounted (user switched to the project main / child chat).
 *
 * Tick strategy (cheap → expensive):
 * 1. status only stages that still need attention (first tick: all)
 * 2. resume only stages that still have pending/running slots
 */
export function TenderLiveMonitorHost() {
  const navState = useNavigationState()
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const [monitor, setMonitor] = useAtom(tenderLiveMonitorAtom)
  const workspaceRootPath = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.rootPath
  const workflow = React.useMemo(() => getBusinessWorkflow('tender'), [])
  const inFlight = React.useRef(false)
  const lastRunsRef = React.useRef<Record<string, TenderStageRunResultDto>>({})
  const coldStartRef = React.useRef(true)

  // Stay alive across Overview ↔ Chat as long as the user remains in 投标工作台.
  const active = Boolean(
    monitor?.active
    && monitor.moduleId === 'tender'
    && workspaceRootPath
    && monitor.workspaceRootPath === workspaceRootPath
    && isTenderNavigation(navState),
  )

  React.useEffect(() => {
    if (!active || !monitor || !workspaceRootPath) return
    coldStartRef.current = true

    const tick = async () => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const byStage: Record<string, TenderStageRunResultDto> = { ...lastRunsRef.current }
        const stagesToStatus = coldStartRef.current
          ? workflow.stages
          : workflow.stages.filter((stage) => stageNeedsStatus(byStage[stage.id]))
        coldStartRef.current = false

        for (const stage of stagesToStatus) {
          try {
            const run = await window.electronAPI.runTenderStage({
              action: 'status',
              workspaceRootPath: monitor.workspaceRootPath,
              projectId: monitor.projectId,
              stageId: stage.id,
            })
            byStage[run.stageId] = run
          } catch {
            // keep previous snapshot for this stage
          }
        }

        for (const stage of workflow.stages) {
          if (!stageNeedsFillUp(byStage[stage.id])) continue
          try {
            const parentSessionId = byStage[stage.id]?.projectParentSessionId
              ?? byStage[stage.id]?.batchProgress?.parentSessionId
            const run = await window.electronAPI.runTenderStage({
              action: 'resume',
              workspaceRootPath: monitor.workspaceRootPath,
              projectId: monitor.projectId,
              stageId: stage.id,
              ...(parentSessionId ? { parentSessionId } : {}),
            })
            byStage[run.stageId] = run
          } catch {
            // keep previous snapshot for this stage
          }
        }

        const runs = Object.values(byStage)
        lastRunsRef.current = byStage
        const stillWork = runs.some((run) => stageHasLiveWork(run) || stageNeedsFillUp(run))
        setMonitor((current) => {
          if (!current || current.projectId !== monitor.projectId) return current
          if (!stillWork) {
            return { ...current, active: false, lastTickAt: Date.now() }
          }
          return { ...current, lastTickAt: Date.now() }
        })
        window.dispatchEvent(new CustomEvent('craft:tender-monitor-tick', {
          detail: { projectId: monitor.projectId, runs },
        }))
      } catch (cause) {
        console.warn('[TenderLiveMonitorHost] monitor tick failed', cause)
      } finally {
        inFlight.current = false
      }
    }

    void tick()
    const timer = window.setInterval(() => void tick(), LIVE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, monitor?.projectId, monitor?.workspaceRootPath, setMonitor, workflow.stages, workspaceRootPath])

  // Soft notice once when monitor auto-stops after work drains while user is in chat.
  const wasActive = React.useRef(false)
  React.useEffect(() => {
    if (monitor?.active) {
      wasActive.current = true
      return
    }
    if (wasActive.current && monitor && !monitor.active && isTenderNavigation(navState) && navState.details?.sessionId) {
      wasActive.current = false
      toast.message('流程监控已结束：当前没有运行中/排队中的批次')
    }
  }, [monitor, navState])

  return null
}
