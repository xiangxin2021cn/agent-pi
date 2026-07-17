import * as React from 'react'
import { FilePlus2, FolderOpen, MessageSquarePlus } from 'lucide-react'
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

export function BusinessProjectOverview({ moduleId, workspaceRootPath, projectId }: BusinessProjectOverviewProps) {
  const { openNewChat, onOpenFile } = useAppShellContext()
  const workflow = React.useMemo(() => getBusinessWorkflow(moduleId), [moduleId])
  const [project, setProject] = React.useState<BusinessProjectRecord | null>(null)
  const [stageRuns, setStageRuns] = React.useState<Record<string, TenderStageRunResultDto>>({})
  const [startingStageId, setStartingStageId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
      const selected = projects.find((entry) => entry.projectId === projectId) ?? null
      setProject(selected)
      if (moduleId === 'tender' && selected) {
        const results = await Promise.all(workflow.stages.map(async (stage) => {
          try {
            return [stage.id, await window.electronAPI.runTenderStage({
              action: 'status', workspaceRootPath, projectId: selected.projectId, stageId: stage.id,
            })] as const
          } catch {
            return null
          }
        }))
        setStageRuns(Object.fromEntries(results.filter((entry): entry is readonly [string, TenderStageRunResultDto] => Boolean(entry))))
      } else {
        setStageRuns({})
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [moduleId, projectId, workflow.stages, workspaceRootPath])

  React.useEffect(() => {
    void refresh()
    const handleChanged = () => void refresh()
    const timer = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('craft:business-projects-changed', handleChanged)
    }
  }, [refresh])

  const handleAddInputs = async () => {
    if (!project) return
    const result = await window.electronAPI.openAttachmentDialog('files')
    if (result.attachments.length === 0) return
    const inputPaths = [...new Set([...project.inputPaths, ...result.attachments.map((item) => item.path)])]
    const updated = await window.electronAPI.updateBusinessProjectInputs({ workspaceRootPath, module: moduleId, projectId, inputPaths })
    setProject(updated)
    window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
    toast.success(`已登记 ${updated.inputPaths.length} 个项目资料文件`)
    void refresh()
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
        if (!launch.ok) {
          const summary = summarizeTenderStage(launch.result)
          toast.error(`阶段启动失败：${summary.missingLabel ?? summary.statusLabel}`)
        }
      }
    } finally {
      setStartingStageId(null)
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
      if (!retried.ok) {
        const summary = summarizeTenderStage(retried.result)
        toast.error(`重试失败：${summary.missingLabel ?? summary.statusLabel}`)
      }
    } finally {
      setStartingStageId(null)
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
        <h2 className="text-sm font-semibold">专业流程</h2>
        <div className="mt-3 divide-y">
          {workflow.stages.map((stage, index) => (
            <div key={stage.id} className="flex items-center gap-4 py-3">
              <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{stage.label}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{stage.prompt}</p>
                {stageRuns[stage.id] && (() => {
                  const summary = summarizeTenderStage(stageRuns[stage.id]!)
                  return (
                    <>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className={cn(
                          'font-medium',
                          stageRuns[stage.id]!.status === 'blocked' && 'text-destructive',
                          stageRuns[stage.id]!.status === 'complete' && 'text-success',
                          stageRuns[stage.id]!.status === 'running' && 'text-accent',
                        )}>{summary.statusLabel}</span>
                        {summary.upstreamLabel && <span>{summary.upstreamLabel}</span>}
                        <span>{summary.sourceLabel}</span>
                        {summary.batchLabel && <span>{summary.batchLabel}</span>}
                        {summary.missingLabel && <span className="max-w-full truncate" title={summary.missingLabel}>{summary.missingLabel}</span>}
                        {summary.packsLabel && <span className="max-w-full truncate" title={summary.packsLabel}>{summary.packsLabel}</span>}
                      </div>
                      {stageRuns[stage.id]!.batchProgress?.tasks.length ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            查看批次任务（{stageRuns[stage.id]!.batchProgress!.tasks.length}）
                          </summary>
                          <div className="mt-2 divide-y border-y">
                            {stageRuns[stage.id]!.batchProgress!.tasks.map((task) => (
                              <div key={task.batchId} className="flex items-start gap-3 py-2">
                                <span className={cn(
                                  'w-12 shrink-0 font-medium',
                                  task.status === 'complete' && 'text-success',
                                  task.status === 'running' && 'text-accent',
                                  (task.status === 'failed' || task.status === 'blocked') && 'text-destructive',
                                )}>{taskStatusLabel(task.status)}</span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-foreground" title={task.name}>{task.name}</p>
                                  <p className="truncate text-muted-foreground" title={task.error ?? task.reportPath}>
                                    {task.error ?? `${task.sessionId ? `会话 ${task.sessionId} · ` : ''}尝试 ${task.attemptCount}`}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </>
                  )
                })()}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={startingStageId !== null || (stageRuns[stage.id]?.status === 'blocked' && !stageRuns[stage.id]?.batchProgress?.failedBatches)}
                title={stageRuns[stage.id]?.status === 'blocked' ? summarizeTenderStage(stageRuns[stage.id]!).missingLabel : undefined}
                onClick={() => void (stageRuns[stage.id]?.batchProgress?.failedBatches
                  ? handleRetryStage(stage)
                  : handleStartStage(stage))}
              >{startingStageId === stage.id
                  ? '处理中…'
                  : stageRuns[stage.id]?.batchProgress?.failedBatches
                    ? '重试失败批次'
                    : '进入阶段'}</Button>
            </div>
          ))}
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
