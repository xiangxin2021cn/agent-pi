import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderKanban,
  FolderOpen,
  MessageSquarePlus,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@craft-agent/ui'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { businessProjectsCacheAtom, businessProjectsCacheKey } from '@/atoms/business-projects'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { routes } from '../../../shared/routes'
import { buildBusinessTaskDraft } from '@/pages/business-module-launcher'
import {
  preflightTenderStageLaunch,
  resolveStageParentSessionId,
  startTenderStageLaunch,
  summarizeTenderStage,
} from '@/pages/business-tender-stage'
import { getBusinessWorkflow } from '@/pages/business-workflows'
import { cn } from '@/lib/utils'
import { getStateIcon, getStateIconStyle, getStateLabel } from '@/config/session-status-config'
import { getSessionStatus } from '@/utils/session'
import { buildSessionHierarchy } from '@/utils/session-hierarchy'
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
  const { t } = useTranslation()
  const {
    openNewChat,
    sessionStatuses,
    onDeleteSession,
    onArchiveSession,
  } = useAppShellContext()
  const { navigate } = useNavigation()
  const availableSessionStatuses = sessionStatuses ?? []
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const setProjectsCache = useSetAtom(businessProjectsCacheAtom)
  const workflow = getBusinessWorkflow(moduleId)
  const [projects, setProjects] = React.useState<BusinessProjectRecord[]>([])
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [collapsedSessionThreads, setCollapsedSessionThreads] = React.useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!workspaceRootPath) {
      setProjects([])
      return
    }
    try {
      const listed = await window.electronAPI.listBusinessProjects({ workspaceRootPath, module: moduleId })
      setProjects(listed)
      setProjectsCache((current) => ({
        ...current,
        [businessProjectsCacheKey(moduleId, workspaceRootPath)]: listed,
      }))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [moduleId, setProjectsCache, workspaceRootPath])

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

  const toggleSessionThread = (sessionId: string) => {
    setCollapsedSessionThreads((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
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

  const handleDeleteProject = async (project: BusinessProjectRecord) => {
    if (!workspaceRootPath) return
    const confirmed = window.confirm(t('businessProjects.deleteProjectConfirm', { name: project.name }))
    if (!confirmed) return
    try {
      await window.electronAPI.unregisterBusinessProject({
        workspaceRootPath,
        module: moduleId,
        projectId: project.projectId,
      })
      window.dispatchEvent(new CustomEvent('craft:business-projects-changed', { detail: { moduleId } }))
      if (selectedProjectId === project.projectId) {
        const listRoute = moduleId === 'tender'
          ? routes.view.tenderWorkspaces()
          : moduleId === 'delivery'
            ? routes.view.deliveryWorkspaces()
            : routes.view.investmentWorkspaces()
        navigate(listRoute)
      }
      toast.success(t('businessProjects.projectRemoved'))
      await refresh()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const handleDeleteSession = async (projectId: string, sessionId: string) => {
    const ok = await onDeleteSession(sessionId)
    if (ok && selectedSessionId === sessionId) {
      onProjectClick(projectId)
    }
  }

  const handleNewTask = async (project: BusinessProjectRecord) => {
    if (!workspaceRootPath) return
    const firstStage = workflow.stages[0]!

    if (moduleId === 'tender') {
      // Prefer the project-lifetime parent — never open a second main chat.
      for (const stage of workflow.stages) {
        try {
          const status = await window.electronAPI.runTenderStage({
            action: 'status',
            workspaceRootPath,
            projectId: project.projectId,
            stageId: stage.id,
          })
          const parentId = status.projectParentSessionId ?? resolveStageParentSessionId(status)
          if (parentId && sessionMetaMap.has(parentId)) {
            onSessionClick(project.projectId, parentId)
            toast.success('已打开项目主会话')
            return
          }
          if (parentId && !sessionMetaMap.has(parentId)) {
            // Stale pointer after status heal failure — fall through to live sidebar root.
            continue
          }
        } catch {
          // Fall through to create on first failure path.
        }
      }

      // Prefer an existing live project root from the left tree over creating a second main chat.
      const liveRoots = sessionsForBusinessProject(sessionMetaMap.values(), moduleId, project.projectId)
        .filter((session) => !session.parentSessionId)
        .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      const liveRoot = liveRoots[0]
      if (liveRoot) {
        try {
          await window.electronAPI.runTenderStage({
            action: 'status',
            workspaceRootPath,
            projectId: project.projectId,
            stageId: firstStage.id,
            parentSessionId: liveRoot.id,
            forceRebindParent: true,
          })
        } catch {
          // Still open the live root even if rebind fails.
        }
        onSessionClick(project.projectId, liveRoot.id)
        toast.success('已打开项目主会话（已重绑旧指针）')
        return
      }
    }

    const launch = moduleId === 'tender'
      ? await preflightTenderStageLaunch(window.electronAPI.runTenderStage, {
          workspaceRootPath, projectId: project.projectId, stageId: firstStage.id,
        })
      : undefined
    if (launch && !launch.ok) {
      const summary = summarizeTenderStage(launch.result)
      toast.error(`阶段尚未就绪：${summary.missingLabel ?? summary.statusLabel}`)
      return
    }
    const parentSession = await openNewChat?.({
      name: moduleId === 'tender' ? project.name : `${project.name} · ${firstStage.label}`,
      workingDirectory: project.rootPath,
      businessContext: { module: moduleId, projectId: project.projectId, workflowId: project.workflowId, stageId: firstStage.id },
      input: buildBusinessTaskDraft(moduleId, project, firstStage, launch?.result),
    })
    if (moduleId === 'tender' && parentSession) {
      const started = await startTenderStageLaunch(window.electronAPI.runTenderStage, {
        workspaceRootPath, projectId: project.projectId, stageId: firstStage.id,
      }, parentSession.id)
      if (!started.ok) {
        const summary = summarizeTenderStage(started.result)
        toast.error(`阶段启动失败：${summary.missingLabel ?? summary.statusLabel}`)
      }
    }
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
          const sessionHierarchy = buildSessionHierarchy(projectSessions)
          const childSessionCount = sessionHierarchy.parentIdByChildId.size
          const isExpanded = expanded.has(project.projectId)
          const renderSessions = (sessions: SessionMeta[], depth = 0, seen = new Set<string>()): React.ReactNode[] => sessions.map((session) => {
            if (seen.has(session.id)) return null
            const nextSeen = new Set(seen).add(session.id)
            const children = sessionHierarchy.childrenByParentId.get(session.id) ?? []
            const descendantCount = sessionHierarchy.descendantCountBySessionId.get(session.id) ?? 0
            const isThreadCollapsed = collapsedSessionThreads.has(session.id)
            const statusId = getSessionStatus(session)
            const statusLabel = session.isProcessing
              ? '运行中'
              : session.hasUnread
                ? '有新输出'
                : getStateLabel(statusId, availableSessionStatuses)
            const messageLabel = session.messageCount ? ` · ${session.messageCount} 条消息` : ''

            return (
              <React.Fragment key={session.id}>
                <ContextMenu modal>
                  <ContextMenuTrigger asChild>
                    <div
                      className={cn(
                        'group/session flex items-center gap-1 rounded px-1 py-1',
                        selectedSessionId === session.id && 'bg-muted',
                      )}
                      data-session-id={session.id}
                      data-session-depth={depth}
                    >
                      {descendantCount > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          title={isThreadCollapsed ? `展开 ${descendantCount} 个子智能体` : `折叠 ${descendantCount} 个子智能体`}
                          onClick={() => toggleSessionThread(session.id)}
                        >
                          {isThreadCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </Button>
                      ) : (
                        <span className="size-6 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onSessionClick(project.projectId, session.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/60"
                      >
                        <span
                          className="flex size-4 shrink-0 items-center justify-center text-xs [&>svg]:size-4"
                          style={getStateIconStyle(statusId, availableSessionStatuses)}
                          title={statusLabel}
                        >
                          {session.isProcessing ? <Spinner className="text-accent" /> : getStateIcon(statusId, availableSessionStatuses)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm">{session.name || session.preview || '未命名任务'}</span>
                            {session.parentSessionKind === 'spawn' && (
                              <Bot className="size-3.5 shrink-0 text-success" aria-label="子智能体" />
                            )}
                          </span>
                          <span className={cn('block truncate text-xs text-muted-foreground', session.isProcessing && 'text-accent')}>
                            {session.parentSessionKind === 'spawn' ? '子智能体 · ' : ''}{statusLabel}{messageLabel}
                          </span>
                        </span>
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <StyledContextMenuItem onSelect={() => onSessionClick(project.projectId, session.id)}>
                      <MessageSquarePlus className="size-3.5" />
                      打开对话
                    </StyledContextMenuItem>
                    {!session.isArchived && (
                      <StyledContextMenuItem onSelect={() => onArchiveSession(session.id)}>
                        <Archive className="size-3.5" />
                        {t('sessionMenu.archive')}
                      </StyledContextMenuItem>
                    )}
                    <StyledContextMenuSeparator />
                    <StyledContextMenuItem
                      variant="destructive"
                      onSelect={() => void handleDeleteSession(project.projectId, session.id)}
                    >
                      <Trash2 className="size-3.5" />
                      {t('common.delete')}
                    </StyledContextMenuItem>
                  </StyledContextMenuContent>
                </ContextMenu>
                {!isThreadCollapsed && children.length > 0 && (
                  <div className="ml-3 border-l pl-2">
                    {renderSessions(children, depth + 1, nextSeen)}
                  </div>
                )}
              </React.Fragment>
            )
          }).filter((node): node is React.ReactElement => node !== null)

          return (
            <div key={project.projectId} className="mb-1">
              <ContextMenu modal>
                <ContextMenuTrigger asChild>
                  <div className={cn('group flex items-center gap-1 rounded px-1 py-1', selectedProjectId === project.projectId && 'bg-muted')}>
                    <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" title={isExpanded ? '折叠' : '展开'} onClick={() => toggleProject(project.projectId)}>
                      {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </Button>
                    <button type="button" onClick={() => onProjectClick(project.projectId)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                      <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{project.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {project.inputPaths.length} 份资料 · {sessionHierarchy.rootItems.length} 个任务
                          {childSessionCount > 0 ? ` · ${childSessionCount} 个子智能体` : ''}
                        </span>
                      </span>
                    </button>
                    <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title="添加项目资料" onClick={() => void handleAddInputs(project)}>
                      <FilePlus2 className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title="新建项目任务" onClick={() => void handleNewTask(project)}>
                      <MessageSquarePlus className="size-4" />
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <StyledContextMenuContent>
                  <StyledContextMenuItem onSelect={() => onProjectClick(project.projectId)}>
                    <FolderKanban className="size-3.5" />
                    打开项目
                  </StyledContextMenuItem>
                  <StyledContextMenuItem onSelect={() => window.electronAPI.showInFolder(project.rootPath)}>
                    <FolderOpen className="size-3.5" />
                    在文件管理器中显示
                  </StyledContextMenuItem>
                  <StyledContextMenuItem onSelect={() => void handleAddInputs(project)}>
                    <FilePlus2 className="size-3.5" />
                    添加资料
                  </StyledContextMenuItem>
                  <StyledContextMenuSeparator />
                  <StyledContextMenuItem
                    variant="destructive"
                    onSelect={() => void handleDeleteProject(project)}
                  >
                    <Trash2 className="size-3.5" />
                    {t('businessProjects.deleteProject')}
                  </StyledContextMenuItem>
                </StyledContextMenuContent>
              </ContextMenu>
              {isExpanded && (
                <div className="ml-8 border-l pl-2">
                  {sessionHierarchy.rootItems.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">暂无任务</p>}
                  {renderSessions(sessionHierarchy.rootItems)}
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
