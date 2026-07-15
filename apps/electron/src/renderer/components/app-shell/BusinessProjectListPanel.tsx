import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ChevronDown, ChevronRight, FilePlus2, FolderKanban, MessageSquarePlus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import { Button } from '@/components/ui/button'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import { getBusinessWorkflow } from '@/pages/business-workflows'
import { cn } from '@/lib/utils'
import { BusinessProjectDialog } from './BusinessProjectDialog'
import { sessionsForBusinessProject } from './business-project-view-model'

interface BusinessProjectListPanelProps {
  moduleId: BusinessModuleId
  workspaceRootPath?: string
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onProjectClick: (projectId: string) => void
  onSessionClick: (projectId: string, sessionId: string) => void
}

export function BusinessProjectListPanel({
  moduleId,
  workspaceRootPath,
  selectedProjectId,
  selectedSessionId,
  onProjectClick,
  onSessionClick,
}: BusinessProjectListPanelProps) {
  const { openNewChat } = useAppShellContext()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const workflow = getBusinessWorkflow(moduleId)
  const [projects, setProjects] = React.useState<BusinessProjectRecord[]>([])
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!workspaceRootPath) {
      setProjects([])
      return
    }
    try {
      setProjects(await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [moduleId, workspaceRootPath])

  React.useEffect(() => {
    void refresh()
    const handleChanged = (event: Event) => {
      const changedModule = (event as CustomEvent<{ moduleId?: BusinessModuleId }>).detail?.moduleId
      if (!changedModule || changedModule === moduleId) void refresh()
    }
    window.addEventListener('craft:business-projects-changed', handleChanged)
    return () => window.removeEventListener('craft:business-projects-changed', handleChanged)
  }, [moduleId, refresh])

  React.useEffect(() => {
    if (!selectedProjectId) return
    setExpanded((current) => new Set(current).add(selectedProjectId))
  }, [selectedProjectId])

  const toggleProject = (projectId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const handleAddInputs = async (project: BusinessProjectRecord) => {
    if (!workspaceRootPath) return
    const result = await window.electronAPI.openAttachmentDialog('files')
    if (result.attachments.length === 0) return
    const inputPaths = [...new Set([...project.inputPaths, ...result.attachments.map((item) => item.path)])]
    await window.electronAPI.updateBusinessProjectInputs({ workspaceRootPath, module: moduleId, projectId: project.projectId, inputPaths })
    window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
    toast.success(`已登记 ${inputPaths.length} 个项目资料文件`)
  }

  const handleNewTask = async (project: BusinessProjectRecord) => {
    const firstStage = workflow.stages[0]!
    await openNewChat?.({
      name: `${project.name} · ${firstStage.label}`,
      workingDirectory: project.rootPath,
      businessContext: { module: moduleId, projectId: project.projectId, workflowId: project.workflowId, stageId: firstStage.id },
      input: buildBusinessTaskDraft(moduleId, project, firstStage),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{workflow.label}</span>
        <Button type="button" variant="ghost" size="icon" title="新建专业项目" disabled={!workspaceRootPath} onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && <p className="p-2 text-sm text-destructive">{error}</p>}
        {!error && projects.length === 0 && (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            <p>尚无{workflow.label}项目</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!workspaceRootPath} onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />新建项目
            </Button>
          </div>
        )}
        {projects.map((project) => {
          const projectSessions = sessionsForBusinessProject(sessionMetaMap.values(), moduleId, project.projectId)
          const isExpanded = expanded.has(project.projectId)
          return (
            <div key={project.projectId} className="mb-1">
              <div className={cn('group flex items-center gap-1 rounded px-1 py-1', selectedProjectId === project.projectId && 'bg-muted')}>
                <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" title={isExpanded ? '折叠' : '展开'} onClick={() => toggleProject(project.projectId)}>
                  {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </Button>
                <button type="button" onClick={() => onProjectClick(project.projectId)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                  <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{project.inputPaths.length} 份资料 · {projectSessions.length} 个任务</span>
                  </span>
                </button>
                <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title="添加项目资料" onClick={() => void handleAddInputs(project)}>
                  <FilePlus2 className="size-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title="新建项目任务" onClick={() => void handleNewTask(project)}>
                  <MessageSquarePlus className="size-4" />
                </Button>
              </div>
              {isExpanded && (
                <div className="ml-8 border-l pl-2">
                  {projectSessions.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">暂无任务</p>}
                  {projectSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSessionClick(project.projectId, session.id)}
                      className={cn('block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60', selectedSessionId === session.id && 'bg-muted')}
                    >
                      {session.name || session.preview || '未命名任务'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {workspaceRootPath && (
        <BusinessProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} moduleId={moduleId} workspaceRootPath={workspaceRootPath} />
      )}
    </div>
  )
}
