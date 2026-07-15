import * as React from 'react'
import { FilePlus2, FolderOpen, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { getBusinessWorkflow, type BusinessWorkflowStage } from '@/pages/business-workflows'

interface BusinessProjectOverviewProps {
  moduleId: BusinessModuleId
  workspaceRootPath: string
  projectId: string
}

export function BusinessProjectOverview({ moduleId, workspaceRootPath, projectId }: BusinessProjectOverviewProps) {
  const { openNewChat, onOpenFile } = useAppShellContext()
  const workflow = getBusinessWorkflow(moduleId)
  const [project, setProject] = React.useState<BusinessProjectRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const projects = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
      setProject(projects.find((entry) => entry.projectId === projectId) ?? null)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [moduleId, projectId, workspaceRootPath])

  React.useEffect(() => {
    void refresh()
    const handleChanged = () => void refresh()
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => window.removeEventListener('craft:business-projects-changed', handleChanged)
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
  }

  const handleStartStage = async (stage: BusinessWorkflowStage) => {
    if (!project) return
    await openNewChat?.({
      name: `${project.name} · ${stage.label}`,
      workingDirectory: project.rootPath,
      businessContext: { module: moduleId, projectId: project.projectId, workflowId: project.workflowId, stageId: stage.id },
      input: buildBusinessTaskDraft(moduleId, project, stage),
    })
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
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void handleStartStage(stage)}>进入阶段</Button>
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
