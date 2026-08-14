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
import { businessStageLabel, businessWorkflowLabel, getBusinessWorkflow } from '@/pages/business-workflows'
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
    toast.success(t('businessProjects.toastFilesRegistered', { count: inputPaths.length }))
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
            toast.success(t('businessProjects.toastOpenedParent'))
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
        toast.success(t('businessProjects.toastOpenedParentRebound'))
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
      toast.error(t('businessProjects.toastStageNotReady', {
        detail: summary.missingLabel ?? summary.statusLabel,
      }))
      return
    }
    const parentSession = await openNewChat?.({
      name: moduleId === 'tender' ? project.name : `${project.name} · ${businessStageLabel(firstStage)}`,
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
        toast.error(t('businessProjects.toastStageStartFailed', {
          detail: summary.missingLabel ?? summary.statusLabel,
        }))
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{businessWorkflowLabel(workflow)}</span>
        <Button type="button" variant="ghost" size="icon" title={t('businessProjects.newSpecialistProject')} disabled={!workspaceRootPath} onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {error && <p className="p-2 text-sm text-destructive">{error}</p>}
        {!error && projects.length === 0 && (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            <p>{t('businessProjects.emptyProjects', { workflow: businessWorkflowLabel(workflow) })}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!workspaceRootPath} onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />{t('businessProjects.newProject')}
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
              ? t('businessProjects.sessionRunning')
              : session.hasUnread
                ? t('businessProjects.hasNewOutput')
                : getStateLabel(statusId, availableSessionStatuses)
            const messageLabel = session.messageCount ? t('businessProjects.messageCount', { count: session.messageCount }) : ''

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
                          title={isThreadCollapsed
                            ? t('businessProjects.expandAgents', { count: descendantCount })
                            : t('businessProjects.collapseAgents', { count: descendantCount })}
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
                            <span className="truncate text-sm">{session.name || session.preview || t('businessProjects.unnamedTask')}</span>
                            {session.parentSessionKind === 'spawn' && (
                              <Bot className="size-3.5 shrink-0 text-success" aria-label={t('businessProjects.childAgent')} />
                            )}
                          </span>
                          <span className={cn('block truncate text-xs text-muted-foreground', session.isProcessing && 'text-accent')}>
                            {session.parentSessionKind === 'spawn' ? t('businessProjects.childAgentPrefix') : ''}{statusLabel}{messageLabel}
                          </span>
                        </span>
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <StyledContextMenuItem onSelect={() => onSessionClick(project.projectId, session.id)}>
                      <MessageSquarePlus className="size-3.5" />
                      {t('businessProjects.openChat')}
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
                    <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" title={isExpanded ? t('businessProjects.collapse') : t('businessProjects.expand')} onClick={() => toggleProject(project.projectId)}>
                      {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </Button>
                    <button type="button" onClick={() => onProjectClick(project.projectId)} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                      <FolderKanban className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{project.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t('businessProjects.filesAndTasks', {
                            files: project.inputPaths.length,
                            tasks: sessionHierarchy.rootItems.length,
                          })}
                          {childSessionCount > 0 ? t('businessProjects.childAgentCount', { count: childSessionCount }) : ''}
                        </span>
                      </span>
                    </button>
                    <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title={t('businessProjects.addProjectFiles')} onClick={() => void handleAddInputs(project)}>
                      <FilePlus2 className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-7 opacity-70 group-hover:opacity-100" title={t('businessProjects.newProjectTask')} onClick={() => void handleNewTask(project)}>
                      <MessageSquarePlus className="size-4" />
                    </Button>
                  </div>
                </ContextMenuTrigger>
                <StyledContextMenuContent>
                  <StyledContextMenuItem onSelect={() => onProjectClick(project.projectId)}>
                    <FolderKanban className="size-3.5" />
                    {t('businessProjects.openProject')}
                  </StyledContextMenuItem>
                  <StyledContextMenuItem onSelect={() => window.electronAPI.showInFolder(project.rootPath)}>
                    <FolderOpen className="size-3.5" />
                    {t('businessProjects.showInFolder')}
                  </StyledContextMenuItem>
                  <StyledContextMenuItem onSelect={() => void handleAddInputs(project)}>
                    <FilePlus2 className="size-3.5" />
                    {t('businessProjects.addFiles')}
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
                  {sessionHierarchy.rootItems.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">{t('businessProjects.noTasksYet')}</p>}
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
