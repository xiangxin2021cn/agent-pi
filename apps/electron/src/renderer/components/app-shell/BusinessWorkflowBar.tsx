import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import type { SessionBusinessContext } from '@craft-agent/shared/business-projects'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { getBusinessWorkflow, type BusinessWorkflowStage } from '@/pages/business-workflows'
import { cn } from '@/lib/utils'

interface BusinessWorkflowBarProps {
  context?: SessionBusinessContext
  workingDirectory?: string
}

export function BusinessWorkflowBar({ context, workingDirectory }: BusinessWorkflowBarProps) {
  const { activeWorkspaceId, workspaces, openNewChat } = useAppShellContext()
  if (!context) return null

  const workflow = getBusinessWorkflow(context.module)
  const currentIndex = Math.max(0, workflow.stages.findIndex((stage) => stage.id === context.stageId))
  const nextStage = workflow.stages[currentIndex + 1]
  const workspaceRootPath = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.rootPath

  const startStage = async (stage: BusinessWorkflowStage) => {
    if (!workspaceRootPath) return
    const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: context.module })
    const project = projects.find((entry) => entry.projectId === context.projectId)
    if (!project) return
    await openNewChat?.({
      name: `${project.name} · ${stage.label}`,
      workingDirectory: project.rootPath || workingDirectory,
      businessContext: { ...context, stageId: stage.id },
      input: buildBusinessTaskDraft(context.module, project, stage),
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b bg-muted/20 px-4 py-2">
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1">
          {workflow.stages.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              title={stage.prompt}
              onClick={() => stage.id !== context.stageId && void startStage(stage)}
              className={cn(
                'h-7 whitespace-nowrap border-b-2 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground',
                stage.id === context.stageId && 'border-primary font-medium text-foreground',
                index < currentIndex && 'text-foreground/70',
              )}
            >
              {index + 1}. {stage.label}
            </button>
          ))}
        </div>
      </div>
      {nextStage && (
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void startStage(nextStage)}>
          下一阶段<ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  )
}
