import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import type { SessionBusinessContext } from '@craft-agent/shared/business-projects'
import type { TenderStageRunResultDto } from '@craft-agent/shared/protocol'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { preflightTenderStageLaunch, startTenderStageLaunch, summarizeTenderStage } from '@/pages/business-tender-stage'
import { getBusinessWorkflow, type BusinessWorkflowStage } from '@/pages/business-workflows'
import { cn } from '@/lib/utils'

interface BusinessWorkflowBarProps {
  context?: SessionBusinessContext
  workingDirectory?: string
}

export function BusinessWorkflowBar({ context, workingDirectory }: BusinessWorkflowBarProps) {
  const { activeWorkspaceId, workspaces, openNewChat } = useAppShellContext()
  const [stageRuns, setStageRuns] = React.useState<Record<string, TenderStageRunResultDto>>({})
  const [startingStageId, setStartingStageId] = React.useState<string | null>(null)
  const workspaceRootPath = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.rootPath
  const workflow = context ? getBusinessWorkflow(context.module) : null
  const currentIndex = workflow ? Math.max(0, workflow.stages.findIndex((stage) => stage.id === context?.stageId)) : 0
  const nextStage = workflow?.stages[currentIndex + 1]
  const contextModule = context?.module
  const contextProjectId = context?.projectId
  const contextStageId = context?.stageId

  React.useEffect(() => {
    if (contextModule !== 'tender' || !contextProjectId || !contextStageId || !workspaceRootPath) {
      setStageRuns({})
      return
    }
    let cancelled = false
    const refreshCurrent = async () => {
      try {
        const result = await window.electronAPI.runTenderStage({
          action: 'status', workspaceRootPath, projectId: contextProjectId, stageId: contextStageId,
        })
        if (!cancelled) setStageRuns((current) => ({ ...current, [contextStageId]: result }))
      } catch {
        // The stage launch path surfaces actionable errors; polling stays quiet.
      }
    }
    void refreshCurrent()
    const timer = window.setInterval(() => void refreshCurrent(), 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [contextModule, contextProjectId, contextStageId, workspaceRootPath])

  if (!context || !workflow) return null

  const startStage = async (stage: BusinessWorkflowStage) => {
    if (!workspaceRootPath) return
    const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: context.module })
    const project = projects.find((entry) => entry.projectId === context.projectId)
    if (!project) return
    setStartingStageId(stage.id)
    try {
      let stageRun: TenderStageRunResultDto | undefined
      if (context.module === 'tender') {
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
        workingDirectory: project.rootPath || workingDirectory,
        businessContext: { ...context, stageId: stage.id },
        input: buildBusinessTaskDraft(context.module, project, stage, stageRun),
      })
      if (context.module === 'tender' && parentSession) {
        const launch = await startTenderStageLaunch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId: project.projectId, stageId: stage.id,
        }, parentSession.id)
        setStageRuns((current) => ({ ...current, [stage.id]: launch.result }))
        if (!launch.ok) {
          const summary = summarizeTenderStage(launch.result)
          toast.error(`阶段启动失败：${summary.missingLabel ?? summary.statusLabel}`)
        }
      }
    } finally {
      setStartingStageId(null)
    }
  }

  const currentStageRun = stageRuns[context.stageId]
  const currentSummary = currentStageRun ? summarizeTenderStage(currentStageRun) : undefined

  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-muted/20 px-4 py-2">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1">
          {workflow.stages.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              title={stage.prompt}
              disabled={startingStageId !== null || stageRuns[stage.id]?.status === 'blocked'}
              onClick={() => stage.id !== context.stageId && void startStage(stage)}
              className={cn(
                'h-7 whitespace-nowrap border-b-2 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground',
                stage.id === context.stageId && 'border-primary font-medium text-foreground',
                index < currentIndex && 'text-foreground/70',
                stageRuns[stage.id]?.status === 'blocked' && 'text-destructive',
                stageRuns[stage.id]?.status === 'complete' && 'text-success',
              )}
            >
              {index + 1}. {stage.label}
            </button>
          ))}
        </div>
      </div>
      {currentSummary && (
        <span className={cn(
          'max-w-64 shrink-0 truncate text-xs text-muted-foreground',
          currentStageRun?.status === 'blocked' && 'text-destructive',
        )} title={[
          currentSummary.upstreamLabel,
          currentSummary.sourceLabel,
          currentSummary.batchLabel,
          currentSummary.missingLabel,
          currentSummary.packsLabel,
        ].filter(Boolean).join(' · ')}>
          {currentSummary.statusLabel}{currentSummary.batchLabel ? ` · ${currentSummary.batchLabel}` : ''}
        </span>
      )}
      {nextStage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={startingStageId !== null || stageRuns[nextStage.id]?.status === 'blocked'}
          onClick={() => void startStage(nextStage)}
        >
          {startingStageId === nextStage.id ? '启动中…' : '下一阶段'}<ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  )
}
