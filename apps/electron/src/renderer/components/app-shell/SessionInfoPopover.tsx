import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bot, CheckCircle2, Circle, DatabaseZap, FileText, FolderOpen, Loader2, RotateCcw, Target } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { getGoalAuditViewModels, type GoalAuditViewModel } from './goal-audit-view-model'
import { getDocumentPlanStatusText } from './document-enhancement-view-model'
import { getGoalStatusText } from './goal-status-view-model'
import { getContextPressureViewModel, resolveModelContextWindow } from './context-pressure-view-model'
import { getProjectMemoryTelemetryResetAction } from './project-memory-view-model'
import type { ProjectMemorySessionStatusResult, SessionOutputDirectory } from '../../../shared/types'

interface SessionInfoPopoverProps {
  sessionId: string
  sessionFolderPath?: string
  trigger: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  presentation?: 'popover' | 'drawer'
}

const DEFAULT_POPOVER_CONTENT_CLASS = 'w-[390px] h-[620px] min-w-[260px] max-w-[440px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
const DEFAULT_DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,42rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export function SessionInfoPopover({
  sessionId,
  sessionFolderPath,
  trigger,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  presentation = 'popover',
}: SessionInfoPopoverProps) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('craft:focus-input', {
          detail: { sessionId },
        }))
      })
    }
  }, [sessionId])

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={cn(DEFAULT_DRAWER_CONTENT_CLASS, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">Session info</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionInfoPanel sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? DEFAULT_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <SessionInfoPanel sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </PopoverContent>
    </Popover>
  )
}

export function SessionInfoPanel({
  sessionId,
  sessionFolderPath,
  className,
}: {
  sessionId: string
  sessionFolderPath?: string
  className?: string
}) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { onRenameSession } = useAppShellContext()
  const [name, setName] = React.useState('')
  const renameTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    setName(session?.name || '')
  }, [session?.name])

  React.useEffect(() => {
    return () => {
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
      }
    }
  }, [])

  const handleNameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)

    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    renameTimeoutRef.current = setTimeout(() => {
      const trimmed = newName.trim()
      if (trimmed) {
        onRenameSession(sessionId, trimmed)
      }
    }, 500)
  }, [onRenameSession, sessionId])

  return (
    <div className={cn("h-full min-h-0 flex flex-col bg-background", className)}>
      <div className="shrink-0 p-3 border-b border-border/50">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
          {t("chat.title")}
        </label>
        <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t("chat.titlePlaceholder")}
            className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
          />
        </div>
      </div>
      <SessionInfoBoard sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      <div className="flex-1 min-h-0 overflow-hidden border-t border-border/50">
        <SessionFilesSection
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          hideHeader={false}
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}

function SessionInfoBoard({ sessionId, sessionFolderPath }: { sessionId: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { enabledSources, llmConnections, workspaceDefaultLlmConnection } = useAppShellContext()
  const [outputDirectory, setOutputDirectory] = React.useState<SessionOutputDirectory | null>(null)
  const [projectMemoryStatus, setProjectMemoryStatus] = React.useState<ProjectMemorySessionStatusResult | null>(null)
  const [projectMemoryResetting, setProjectMemoryResetting] = React.useState(false)
  const [projectMemoryResetMessage, setProjectMemoryResetMessage] = React.useState<string | undefined>()

  const refreshProjectMemoryStatus = React.useCallback(async () => {
    const result = await window.electronAPI.getSessionProjectMemoryStatus(sessionId)
    setProjectMemoryStatus(result)
  }, [sessionId])

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getSessionOutputDirectory(sessionId)
      .then(result => {
        if (!cancelled) setOutputDirectory(result)
      })
      .catch(() => {
        if (!cancelled) setOutputDirectory(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, session?.workingDirectory])

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.getSessionProjectMemoryStatus(sessionId)
      .then(result => {
        if (!cancelled) setProjectMemoryStatus(result)
      })
      .catch(() => {
        if (!cancelled) setProjectMemoryStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshProjectMemoryStatus, session?.workingDirectory, session?.messageCount, session?.goalState?.updatedAt])

  const connection = React.useMemo(() => {
    const slug = session?.llmConnection ?? workspaceDefaultLlmConnection
    return slug ? llmConnections.find(conn => conn.slug === slug) : llmConnections.find(conn => conn.isDefault)
  }, [llmConnections, session?.llmConnection, workspaceDefaultLlmConnection])

  const sourceNames = React.useMemo(() => {
    const slugs = session?.enabledSourceSlugs ?? []
    if (slugs.length === 0) return []
    const bySlug = new Map((enabledSources ?? []).map(source => [source.config.slug, source.config.name]))
    return slugs.map(slug => bySlug.get(slug) ?? slug)
  }, [enabledSources, session?.enabledSourceSlugs])

  const goalStatus = session?.goalState
    ? getGoalStatusText(t, session.goalState.status, session.goalState.iteration, session.goalState.maxIterations)
    : undefined
  const goalAuditItems = React.useMemo(() => getGoalAuditViewModels(session?.goalState), [session?.goalState])
  const visibleGoalAuditItems = goalAuditItems.slice(0, 1)
  const hiddenGoalAuditCount = Math.max(0, goalAuditItems.length - visibleGoalAuditItems.length)
  const documentPlanStatus = React.useMemo(
    () => getDocumentPlanStatusText(t, session?.goalState),
    [session?.goalState, t],
  )
  const contextPressure = React.useMemo(() => getContextPressureViewModel({
    enabledSourceCount: sourceNames.length,
    contextWindow: session?.tokenUsage?.contextWindow ?? resolveModelContextWindow({
      sessionModel: session?.model,
      connection,
    }),
    inputTokens: session?.tokenUsage?.inputTokens,
  }), [connection, session?.model, session?.tokenUsage?.contextWindow, session?.tokenUsage?.inputTokens, sourceNames.length])
  const projectMemoryResetAction = React.useMemo(() => getProjectMemoryTelemetryResetAction({
    status: projectMemoryStatus,
    isResetting: projectMemoryResetting,
  }), [projectMemoryResetting, projectMemoryStatus])
  const handleResetProjectMemoryTelemetry = React.useCallback(async () => {
    if (!projectMemoryResetAction.enabled) return
    setProjectMemoryResetting(true)
    setProjectMemoryResetMessage(undefined)
    try {
      const result = await window.electronAPI.resetSessionProjectMemoryQualityTelemetry(sessionId)
      if (result?.status === 'reset') {
        setProjectMemoryResetMessage(t('sessionInfo.projectMemoryResetTelemetryDone', {
          count: result.removedCount ?? 0,
          defaultValue: 'Reset {{count}} learned telemetry facts.',
        }))
      }
      await refreshProjectMemoryStatus()
    } catch {
      setProjectMemoryResetMessage(t('sessionInfo.projectMemoryResetTelemetryFailed', { defaultValue: 'Reset failed.' }))
    } finally {
      setProjectMemoryResetting(false)
    }
  }, [projectMemoryResetAction.enabled, refreshProjectMemoryStatus, sessionId, t])

  const progressItems = [
    {
      key: 'status',
      icon: session?.isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />,
      label: session?.isProcessing ? t('sessionInfo.running') : t('sessionInfo.ready'),
      value: session?.currentStatus?.message ?? t('sessionInfo.messagesCount', { count: session?.messageCount ?? session?.messages?.length ?? 0 }),
      active: session?.isProcessing,
    },
    {
      key: 'model',
      icon: <Bot className="h-3.5 w-3.5" />,
      label: t('common.model'),
      value: [connection?.name, session?.model].filter(Boolean).join(' · ') || t('chat.connectionDefault'),
    },
    ...(session?.goalState && goalStatus ? [{
      key: 'goal',
      icon: session.goalState.status === 'auditing' || session.goalState.status === 'improving'
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Target className="h-3.5 w-3.5" />,
      label: t('sessionInfo.goal'),
      value: goalStatus,
      active: ['running', 'auditing', 'improving'].includes(session.goalState.status),
    }] : []),
    ...(documentPlanStatus ? [{
      key: 'documentPlan',
      icon: <FileText className="h-3.5 w-3.5" />,
      label: t('sessionInfo.documentPlan', { defaultValue: 'Document Plan' }),
      value: documentPlanStatus,
      active: true,
    }] : []),
    ...(contextPressure ? [{
      key: 'contextPressure',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      label: contextPressure.label,
      value: contextPressure.detail,
      active: contextPressure.level === 'high',
    }] : []),
    {
      key: 'workdir',
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      label: t('chat.workingDirectory'),
      value: session?.workingDirectory ?? sessionFolderPath ?? t('session.sessionFolderFallback'),
    },
    ...(session?.workingDirectory ? [{
      key: 'projectMemory',
      icon: <DatabaseZap className="h-3.5 w-3.5" />,
      label: t('sessionInfo.projectMemory', { defaultValue: 'Project memory' }),
      value: projectMemoryResetMessage ?? getProjectMemoryStatusText(t, projectMemoryStatus),
      active: projectMemoryStatus?.status === 'lite_ready',
      action: {
        icon: projectMemoryResetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />,
        label: t(projectMemoryResetAction.labelKey, { defaultValue: projectMemoryResetAction.defaultLabel }),
        disabled: !projectMemoryResetAction.enabled,
        onClick: handleResetProjectMemoryTelemetry,
      },
    }] : []),
  ]

  return (
    <div className="shrink-0 max-h-[300px] overflow-y-auto px-3 py-3 space-y-3">
      <InfoBlock title={t('sessionInfo.progress')}>
        {progressItems.map(item => (
          <InfoLine
            key={item.key}
            icon={item.icon}
            label={item.label}
            value={item.value}
            active={item.active}
            action={item.action}
          />
        ))}
      </InfoBlock>

      <InfoBlock title={t('sessionInfo.outputs')}>
        <InfoPathButton
          icon={<FileText className="h-3.5 w-3.5" />}
          label={t('chat.formalOutputs')}
          value={outputDirectory?.path ?? t('chat.noOutputYet')}
          disabled={!outputDirectory?.exists}
          onClick={outputDirectory?.path ? () => window.electronAPI.showInFolder(outputDirectory.path) : undefined}
        />
        {sessionFolderPath && (
          <InfoPathButton
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label={t('session.sessionFolderFallback')}
            value={sessionFolderPath}
            onClick={() => window.electronAPI.showInFolder(sessionFolderPath)}
          />
        )}
      </InfoBlock>

      <InfoBlock title={t('sessionInfo.sources')}>
        {sourceNames.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sourceNames.slice(0, 6).map(name => (
              <span
                key={name}
                className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-[6px] bg-foreground/5 px-2 text-[11px] text-foreground/75"
              >
                <DatabaseZap className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </span>
            ))}
            {sourceNames.length > 6 && (
              <span className="inline-flex h-6 items-center rounded-[6px] bg-foreground/5 px-2 text-[11px] text-muted-foreground">
                +{sourceNames.length - 6}
              </span>
            )}
          </div>
        ) : (
          <InfoLine
            icon={<Circle className="h-3.5 w-3.5" />}
            label={t('sessionInfo.noSources')}
            value={t('sessionInfo.noSourcesHint')}
          />
        )}
      </InfoBlock>

      {goalAuditItems.length > 0 && (
        <InfoBlock title={t('sessionInfo.goalAuditHistory')}>
          <div className="space-y-1.5">
            {visibleGoalAuditItems.map(item => (
              <GoalAuditCard key={`${item.iteration}-${item.createdAt}`} item={item} />
            ))}
            {hiddenGoalAuditCount > 0 && (
              <div className="rounded-[6px] bg-foreground/[0.025] px-2 py-1 text-[11px] text-muted-foreground">
                {t('sessionInfo.goalAuditOlderHidden', {
                  count: hiddenGoalAuditCount,
                  defaultValue: '{{count}} older audit rounds hidden to keep output files visible.',
                })}
              </div>
            )}
          </div>
        </InfoBlock>
      )}
    </div>
  )
}

function GoalAuditCard({ item }: { item: GoalAuditViewModel }) {
  const { t } = useTranslation()
  const statusTone = item.status === 'pass'
    ? 'text-success'
    : item.status === 'fail'
    ? 'text-destructive'
    : 'text-info'

  return (
    <div className="rounded-[7px] bg-foreground/[0.025] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Target className={cn("h-3.5 w-3.5 shrink-0", statusTone)} />
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/82">
          {t('sessionInfo.goalAuditIteration', { iteration: item.iteration })}
        </div>
        <div className={cn("shrink-0 text-[11px] font-medium", statusTone)}>
          {getGoalAuditStatusText(t, item.status)}
        </div>
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
        {item.summary}
      </div>
      {item.documentExpertReport && (
        <DocumentExpertReportCard report={item.documentExpertReport} />
      )}
      {item.qualityRoute && (
        <QualityRouteCard route={item.qualityRoute} />
      )}
      {item.failureCategories.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.failureCategories.map(category => (
            <span
              key={category.id}
              className="inline-flex items-center rounded-[5px] bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
            >
              {t(category.labelKey)}
            </span>
          ))}
          {item.hiddenFailureCategoryCount > 0 && (
            <span className="inline-flex items-center rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('sessionInfo.goalAuditMoreItems', { count: item.hiddenFailureCategoryCount })}
            </span>
          )}
        </div>
      )}
      {item.missingCriteria.length > 0 && (
        <div className="mt-1.5 space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/75">
            {t('sessionInfo.goalAuditMissing')}
          </div>
          {item.missingCriteria.map((criterion, index) => (
            <div key={`${index}-${criterion}`} className="truncate text-[11px] leading-4 text-foreground/70" title={criterion}>
              {criterion}
            </div>
          ))}
          {item.hiddenMissingCriteriaCount > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {t('sessionInfo.goalAuditMoreItems', { count: item.hiddenMissingCriteriaCount })}
            </div>
          )}
        </div>
      )}
      {item.evidence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.evidence.map((evidence, index) => {
            const label = evidence.detail
              ? `${evidence.label}: ${evidence.detail}`
              : evidence.label
            return (
              <span
                key={`${index}-${evidence.type}-${evidence.label}`}
                className="inline-flex max-w-full items-center rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/70"
                title={label}
              >
                <span className="mr-1 text-muted-foreground">{getGoalEvidenceTypeText(t, evidence.type)}</span>
                <span className="truncate">{label}</span>
              </span>
            )
          })}
          {item.hiddenEvidenceCount > 0 && (
            <span className="inline-flex items-center rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('sessionInfo.goalAuditMoreItems', { count: item.hiddenEvidenceCount })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function QualityRouteCard({ route }: { route: NonNullable<GoalAuditViewModel['qualityRoute']> }) {
  const { t } = useTranslation()
  const healthTone = route.health === 'degraded'
    ? 'text-warning'
    : route.health === 'mixed'
    ? 'text-info'
    : 'text-muted-foreground'
  const budgetText = `${route.extraReviewersUsed}/${route.extraReviewersLimit}`
  const detail = route.commonGaps.length > 0
    ? route.commonGaps.join(', ')
    : route.routeHistory || route.task

  return (
    <div className="mt-1.5 rounded-[6px] bg-background/70 px-2 py-1.5 ring-1 ring-border/50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/75">
          {t('sessionInfo.qualityRoute', { defaultValue: 'Quality route' })}
        </span>
        <span className={cn('text-[11px] font-semibold', healthTone)}>
          {t(`sessionInfo.qualityRouteHealth.${route.health}`, {
            defaultValue: route.health.replace(/_/g, ' '),
          })}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <span className="inline-flex min-w-0 items-center rounded-[5px] bg-foreground/[0.035] px-1.5 py-0.5 text-[10px] text-foreground/70">
          <span className="mr-1 text-muted-foreground">{t('sessionInfo.qualityRouteTask', { defaultValue: 'Task' })}</span>
          <span className="truncate">{route.task}</span>
        </span>
        <span className="inline-flex min-w-0 items-center rounded-[5px] bg-foreground/[0.035] px-1.5 py-0.5 text-[10px] text-foreground/70">
          <span className="mr-1 text-muted-foreground">{t('sessionInfo.qualityRouteExtraReviewers', { defaultValue: 'Extra reviewers' })}</span>
          <span>{budgetText}</span>
        </span>
        {route.addedRouteHistoryReviewer && (
          <span className="inline-flex min-w-0 items-center rounded-[5px] bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            {t('sessionInfo.qualityRouteHistoryReviewerAdded', { defaultValue: 'History reviewer added' })}
          </span>
        )}
        {!route.addedRouteHistoryReviewer && route.health === 'degraded' && route.extraReviewersLimit === 0 && (
          <span className="inline-flex min-w-0 items-center rounded-[5px] bg-foreground/[0.035] px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('sessionInfo.qualityRouteBudgetDisabled', { defaultValue: 'Budget disabled' })}
          </span>
        )}
      </div>
      {detail && (
        <div className="mt-1 line-clamp-1 text-[10px] leading-4 text-muted-foreground" title={detail}>
          {detail}
        </div>
      )}
    </div>
  )
}

function DocumentExpertReportCard({ report }: { report: NonNullable<GoalAuditViewModel['documentExpertReport']> }) {
  const { t } = useTranslation()
  const dimensions = [
    { key: 'structure', label: t('sessionInfo.documentExpertStructure', { defaultValue: 'Structure' }), value: report.dimensions.structure },
    { key: 'evidence', label: t('sessionInfo.documentExpertEvidence', { defaultValue: 'Evidence' }), value: report.dimensions.evidence },
    { key: 'numbers', label: t('sessionInfo.documentExpertNumbers', { defaultValue: 'Numbers' }), value: report.dimensions.numbers },
    { key: 'specification', label: t('sessionInfo.documentExpertSpecification', { defaultValue: 'Spec' }), value: report.dimensions.specification },
    { key: 'risk', label: t('sessionInfo.documentExpertRisk', { defaultValue: 'Risk' }), value: report.dimensions.risk },
  ]

  return (
    <div className="mt-1.5 rounded-[6px] bg-background/70 px-2 py-1.5 ring-1 ring-border/50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/75">
          {t('sessionInfo.documentExperts', { defaultValue: 'Document experts' })}
        </span>
        <span className={cn(
          'text-[11px] font-semibold',
          report.status === 'pass' ? 'text-success' : 'text-destructive',
        )}>
          {report.score}/{report.threshold}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {dimensions.map(dimension => (
          <div key={dimension.key} className="min-w-0 rounded-[5px] bg-foreground/[0.035] px-1 py-1 text-center">
            <div className="truncate text-[9px] leading-3 text-muted-foreground" title={dimension.label}>
              {dimension.label}
            </div>
            <div className={cn(
              'text-[11px] font-medium leading-4',
              dimension.value >= 75 ? 'text-success' : dimension.value >= 60 ? 'text-info' : 'text-destructive',
            )}>
              {dimension.value}
            </div>
          </div>
        ))}
      </div>
      {report.issues.length > 0 && (
        <div className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-foreground/68">
          {report.issues.join(' ')}
        </div>
      )}
    </div>
  )
}

function getGoalAuditStatusText(t: ReturnType<typeof useTranslation>['t'], status: GoalAuditViewModel['status']): string {
  switch (status) {
    case 'pass':
      return t('sessionInfo.goalAuditPass')
    case 'fail':
      return t('sessionInfo.goalAuditFail')
    case 'uncertain':
      return t('sessionInfo.goalAuditUncertain')
  }
}

function getGoalEvidenceTypeText(t: ReturnType<typeof useTranslation>['t'], type: GoalAuditViewModel['evidence'][number]['type']): string {
  switch (type) {
    case 'file':
      return t('sessionInfo.goalEvidenceFile')
    case 'message':
      return t('sessionInfo.goalEvidenceMessage')
    case 'system':
      return t('sessionInfo.goalEvidenceSystem')
    case 'test':
      return t('sessionInfo.goalEvidenceTest')
    case 'tool':
      return t('sessionInfo.goalEvidenceTool')
  }
}

function getProjectMemoryStatusText(
  t: ReturnType<typeof useTranslation>['t'],
  status: ProjectMemorySessionStatusResult | null,
): string {
  if (!status) {
    return t('sessionInfo.projectMemoryChecking', { defaultValue: 'Checking memory status...' })
  }

  const suffix = typeof status.entryCount === 'number'
    ? t('sessionInfo.projectMemoryEntries', { count: status.entryCount, defaultValue: '{{count}} entries' })
    : undefined

  switch (status.status) {
    case 'lite_ready':
      return [t('sessionInfo.projectMemoryLiteReady', { defaultValue: 'Project Memory Lite ready' }), suffix].filter(Boolean).join(' · ')
    case 'not_initialized':
      return t('sessionInfo.projectMemoryNotInitialized', { defaultValue: 'Not initialized' })
    case 'missing_working_directory':
      return t('sessionInfo.projectMemoryNoWorkdir', { defaultValue: 'No working directory' })
  }
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">
        {title}
      </div>
      <div className="space-y-1">
        {children}
      </div>
    </section>
  )
}

function InfoLine({
  icon,
  label,
  value,
  active,
  action,
}: {
  icon: React.ReactNode
  label: string
  value: string
  active?: boolean
  action?: {
    icon: React.ReactNode
    label: string
    disabled?: boolean
    onClick: () => void
  }
}) {
  return (
    <div className="flex items-start gap-2 rounded-[7px] px-2 py-1.5 bg-foreground/[0.025]">
      <span className={cn("mt-0.5 shrink-0", active ? "text-accent" : "text-muted-foreground")}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-foreground/82 truncate">{label}</div>
        <div className="text-[11px] leading-4 text-muted-foreground truncate" title={value}>{value}</div>
      </div>
      {action ? (
        <button
          type="button"
          disabled={action.disabled}
          onClick={action.onClick}
          title={action.label}
          aria-label={action.label}
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors",
            action.disabled ? "cursor-default opacity-45" : "hover:bg-foreground/8 hover:text-foreground"
          )}
        >
          {action.icon}
        </button>
      ) : null}
    </div>
  )
}

function InfoPathButton({
  icon,
  label,
  value,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left bg-foreground/[0.025] transition-colors",
        disabled || !onClick ? "opacity-60 cursor-default" : "hover:bg-foreground/5"
      )}
      title={value}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-foreground/82 truncate">{label}</span>
        <span className="block text-[11px] leading-4 text-muted-foreground truncate">{value}</span>
      </span>
    </button>
  )
}
