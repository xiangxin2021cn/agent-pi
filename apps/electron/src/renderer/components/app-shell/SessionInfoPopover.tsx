import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, CheckCircle2, Circle, DatabaseZap, FileText, FolderOpen, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import type { SessionOutputDirectory } from '../../../shared/types'

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
  }, [sessionId])

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
    {
      key: 'workdir',
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      label: t('chat.workingDirectory'),
      value: session?.workingDirectory ?? sessionFolderPath ?? t('session.sessionFolderFallback'),
    },
  ]

  return (
    <div className="shrink-0 px-3 py-3 space-y-3">
      <InfoBlock title={t('sessionInfo.progress')}>
        {progressItems.map(item => (
          <InfoLine
            key={item.key}
            icon={item.icon}
            label={item.label}
            value={item.value}
            active={item.active}
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
    </div>
  )
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
}: {
  icon: React.ReactNode
  label: string
  value: string
  active?: boolean
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
