import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseZap, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sourceSelection } from '@/hooks/useEntitySelection'
import { SourceMenu } from './SourceMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import type { LoadedSource, SourceConnectionStatus, SourceFilter } from '../../../shared/types'
import { getKnowledgeBaseFolder, isKnowledgeBaseSource, suggestKnowledgeBaseCategory } from '@craft-agent/shared/sources/knowledge-base'
import { buildKnowledgeBaseSourceSections } from './knowledge-base-source-list-view-model'
import { KnowledgeBaseCategoryDialog } from '../right-sidebar/KnowledgeBaseCategoryDialog'

const ANYSEARCH_SOURCE_ID = 'anysearch-mcp'
const ANYSEARCH_SOURCE_SLUG = 'anysearch-mcp'
const ANYSEARCH_DOCS_URL = 'https://www.anysearch.com/docs#search-api'
const ANYSEARCH_API_KEYS_URL = 'https://anysearch.com/console/api-keys'

const SOURCE_TYPE_CONFIG: Record<string, { labelKey: string; colorClass: string }> = {
  mcp: { labelKey: 'sourcesList.typeMcp', colorClass: 'bg-accent/10 text-accent' },
  api: { labelKey: 'sourcesList.typeApi', colorClass: 'bg-success/10 text-success' },
  local: { labelKey: 'sourcesList.typeLocal', colorClass: 'bg-info/10 text-info' },
}

const SOURCE_STATUS_CONFIG: Record<string, { labelKey: string; colorClass: string } | null> = {
  connected: null,
  needs_auth: { labelKey: 'sourcesList.statusAuthRequired', colorClass: 'bg-warning/10 text-warning' },
  failed: { labelKey: 'sourcesList.statusDisconnected', colorClass: 'bg-destructive/10 text-destructive' },
  untested: { labelKey: 'sourcesList.statusNotTested', colorClass: 'bg-foreground/10 text-foreground/50' },
  local_disabled: { labelKey: 'sourcesList.statusDisabled', colorClass: 'bg-foreground/10 text-foreground/50' },
}

const SOURCE_TYPE_FILTER_LABEL_KEYS: Record<string, string> = {
  api: 'sourcesList.filterApi',
  mcp: 'sourcesList.filterMcp',
  local: 'sourcesList.filterLocalFolder',
}

export interface SourcesListPanelProps {
  sources: LoadedSource[]
  sourceFilter?: SourceFilter | null
  workspaceRootPath?: string
  onDeleteSource: (sourceSlug: string) => void
  onSourceClick: (source: LoadedSource) => void
  selectedSourceSlug?: string | null
  localMcpEnabled?: boolean
  className?: string
}

export function SourcesListPanel({
  sources,
  sourceFilter,
  workspaceRootPath,
  onDeleteSource,
  onSourceClick,
  selectedSourceSlug,
  localMcpEnabled = true,
  className,
}: SourcesListPanelProps) {
  const { t } = useTranslation()
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1
  const [anySearchDialogOpen, setAnySearchDialogOpen] = React.useState(false)
  const [anySearchApiKey, setAnySearchApiKey] = React.useState('')
  const [anySearchError, setAnySearchError] = React.useState<string | null>(null)
  const [anySearchLoading, setAnySearchLoading] = React.useState(false)
  const [collapsedKnowledgeBaseFolders, setCollapsedKnowledgeBaseFolders] = React.useState<Set<string>>(() => new Set())
  const [pendingKnowledgeBaseImportPath, setPendingKnowledgeBaseImportPath] = React.useState<string | null>(null)
  const [knowledgeBaseImportLoading, setKnowledgeBaseImportLoading] = React.useState(false)

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return sources
    if (sourceFilter.kind === 'knowledgeBase') {
      return sources.filter(isKnowledgeBaseSource)
    }
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  const knowledgeBaseGroups = React.useMemo(() => {
    if (sourceFilter?.kind !== 'knowledgeBase') return undefined
    return buildKnowledgeBaseSourceSections(filteredSources).map(section => ({
      key: section.folder,
      label: section.label,
      description: section.description,
      items: section.sources,
      collapsible: section.collapsible,
      collapsedCount: section.sources.length,
      variant: 'project' as const,
    }))
  }, [filteredSources, sourceFilter])

  const knowledgeBaseCategories = React.useMemo(() => {
    const categories = new Set<string>()
    for (const source of sources) {
      if (!isKnowledgeBaseSource(source)) continue
      const folder = getKnowledgeBaseFolder(source)
      if (folder) categories.add(folder)
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b))
  }, [sources])

  const pendingKnowledgeBaseImportFileName = React.useMemo(() => {
    return pendingKnowledgeBaseImportPath ? getPathFileName(pendingKnowledgeBaseImportPath) : undefined
  }, [pendingKnowledgeBaseImportPath])

  const pendingKnowledgeBaseImportSuggestion = React.useMemo(() => {
    if (!pendingKnowledgeBaseImportPath || !pendingKnowledgeBaseImportFileName) return ''
    return suggestKnowledgeBaseCategory({
      fileName: pendingKnowledgeBaseImportFileName,
      filePath: pendingKnowledgeBaseImportPath,
      existingCategories: knowledgeBaseCategories,
    })
  }, [knowledgeBaseCategories, pendingKnowledgeBaseImportFileName, pendingKnowledgeBaseImportPath])

  const handleToggleKnowledgeBaseFolder = React.useCallback((folder: string) => {
    setCollapsedKnowledgeBaseFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }, [])

  const handleCollapseAllKnowledgeBaseFolders = React.useCallback(() => {
    const folders = knowledgeBaseGroups?.map(group => group.key) ?? []
    setCollapsedKnowledgeBaseFolders(new Set(folders))
  }, [knowledgeBaseGroups])

  const handleExpandAllKnowledgeBaseFolders = React.useCallback(() => {
    setCollapsedKnowledgeBaseFolders(new Set())
  }, [])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'knowledgeBase') {
      return t('sourcesList.noSourcesOfType', { type: t('sourcesList.filterKnowledgeBase') })
    }
    if (sourceFilter?.kind === 'type') {
      const filterLabelKey = SOURCE_TYPE_FILTER_LABEL_KEYS[sourceFilter.sourceType]
      const filterLabel = filterLabelKey ? t(filterLabelKey) : sourceFilter.sourceType
      return t('sourcesList.noSourcesOfType', { type: filterLabel })
    }
    return t('sourcesList.noSourcesConfigured')
  }, [sourceFilter, t])

  const showAnySearchLoader = React.useMemo(() => {
    const hasAnySearch = sources.some(source => source.config.slug === ANYSEARCH_SOURCE_SLUG)
    const filterAllowsMcp = !sourceFilter || (sourceFilter.kind === 'type' && sourceFilter.sourceType === 'mcp')
    return !!activeWorkspaceId && !hasAnySearch && filterAllowsMcp
  }, [activeWorkspaceId, sourceFilter, sources])

  const showKnowledgeBaseFileLoader = !!activeWorkspaceId && sourceFilter?.kind === 'knowledgeBase'

  const handleLoadAnySearch = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    setAnySearchLoading(true)
    setAnySearchError(null)
    try {
      await window.electronAPI.installRecommendedSource(activeWorkspaceId, ANYSEARCH_SOURCE_ID)
      setAnySearchDialogOpen(true)
    } catch (error) {
      setAnySearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setAnySearchLoading(false)
    }
  }, [activeWorkspaceId])

  const handleSaveAnySearchKey = React.useCallback(async () => {
    if (!activeWorkspaceId) return
    const credential = anySearchApiKey.trim()
    if (!credential) return

    setAnySearchLoading(true)
    setAnySearchError(null)
    try {
      await window.electronAPI.saveSourceCredentials(activeWorkspaceId, ANYSEARCH_SOURCE_SLUG, credential)
      setAnySearchApiKey('')
      setAnySearchDialogOpen(false)
    } catch (error) {
      setAnySearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setAnySearchLoading(false)
    }
  }, [activeWorkspaceId, anySearchApiKey])

  const handleAddKnowledgeBaseFile = React.useCallback(async () => {
    if (!activeWorkspaceId || knowledgeBaseImportLoading) return
    const paths = await window.electronAPI.openFileDialog()
    const filePath = paths[0]
    if (filePath) {
      setPendingKnowledgeBaseImportPath(filePath)
    }
  }, [activeWorkspaceId, knowledgeBaseImportLoading])

  const handleConfirmKnowledgeBaseImportCategory = React.useCallback(async (category: string) => {
    if (!activeWorkspaceId || !pendingKnowledgeBaseImportPath) return

    const filePath = pendingKnowledgeBaseImportPath
    setKnowledgeBaseImportLoading(true)
    setPendingKnowledgeBaseImportPath(null)
    try {
      const result = await window.electronAPI.createKnowledgeBaseFileSource(activeWorkspaceId, filePath, {
        name: getPathFileName(filePath),
        autoEnable: false,
        knowledgeBase: { category },
      })
      toast.success(t('chat.knowledgeBaseSourceCreated'), {
        description: result.sourceSlug,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('chat.failedToCreateKnowledgeBaseSource'), { description: message })
    } finally {
      setKnowledgeBaseImportLoading(false)
    }
  }, [activeWorkspaceId, pendingKnowledgeBaseImportPath, t])

  const handleCloseKnowledgeBaseImportDialog = React.useCallback((open: boolean) => {
    if (!open) setPendingKnowledgeBaseImportPath(null)
  }, [])

  return (
    <>
    {showKnowledgeBaseFileLoader && (
      <div className="px-2 pb-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleAddKnowledgeBaseFile}
          disabled={knowledgeBaseImportLoading}
        >
          <Upload className="h-3.5 w-3.5" />
          {t('sourcesList.addKnowledgeBaseFile')}
        </Button>
      </div>
    )}

    {showAnySearchLoader && (
      <div className="px-2 pb-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleLoadAnySearch}
          disabled={anySearchLoading}
        >
          <Search className="h-3.5 w-3.5" />
          Load AnySearch MCP
        </Button>
        {anySearchError && !anySearchDialogOpen && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {anySearchError}
          </div>
        )}
      </div>
    )}

    <EntityPanel<LoadedSource>
      items={filteredSources}
      groups={knowledgeBaseGroups}
      getId={(s) => s.config.slug}
      selection={sourceSelection}
      selectedId={selectedSourceSlug}
      onItemClick={onSourceClick}
      collapsedGroups={sourceFilter?.kind === 'knowledgeBase' ? collapsedKnowledgeBaseFolders : undefined}
      onToggleCollapse={sourceFilter?.kind === 'knowledgeBase' ? handleToggleKnowledgeBaseFolder : undefined}
      onCollapseAll={sourceFilter?.kind === 'knowledgeBase' ? handleCollapseAllKnowledgeBaseFolders : undefined}
      onExpandAll={sourceFilter?.kind === 'knowledgeBase' ? handleExpandAllKnowledgeBaseFolders : undefined}
      className={className}
      containerProps={{ 'data-list-role': 'sources' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<DatabaseZap />}
          title={emptyMessage}
          description={t('sourcesList.emptyDescription')}
          docKey="sources"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  {t('sourcesList.addSource')}
                </button>
              }
              {...getEditConfig(
                sourceFilter?.kind === 'knowledgeBase'
                  ? 'add-source-knowledge-base'
                  : sourceFilter?.kind === 'type'
                    ? `add-source-${sourceFilter.sourceType}` as EditContextKey
                    : 'add-source',
                workspaceRootPath
              )}
            />
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(source) => {
        const connectionStatus = deriveConnectionStatus(source, localMcpEnabled)
        const typeConfig = SOURCE_TYPE_CONFIG[source.config.type]
        const statusConfig = SOURCE_STATUS_CONFIG[connectionStatus]
        const subtitle = source.config.tagline || source.config.provider || ''
        const isKnowledgeBase = isKnowledgeBaseSource(source)
        const knowledgeBaseFolder = isKnowledgeBase ? getKnowledgeBaseFolder(source) : null
        return {
          icon: <SourceAvatar source={source} size="sm" />,
          title: source.config.name,
          badges: (
            <>
              {isKnowledgeBase && (
                <EntityListBadge colorClass="bg-primary/10 text-primary">{t('sourcesList.typeKnowledgeBase')}</EntityListBadge>
              )}
              {knowledgeBaseFolder && (
                <EntityListBadge colorClass="bg-foreground/10 text-foreground/60">{knowledgeBaseFolder}</EntityListBadge>
              )}
              {typeConfig && <EntityListBadge colorClass={typeConfig.colorClass}>{t(typeConfig.labelKey)}</EntityListBadge>}
              {statusConfig && (
                <EntityListBadge colorClass={statusConfig.colorClass} tooltip={source.config.connectionError || undefined} className="cursor-default">
                  {t(statusConfig.labelKey)}
                </EntityListBadge>
              )}
              {subtitle && <span className="truncate">{subtitle}</span>}
            </>
          ),
          menu: (
            <SourceMenu
              sourceSlug={source.config.slug}
              sourceName={source.config.name}
              onOpenInNewWindow={() => window.electronAPI.openUrl(`agentpi://sources/source/${source.config.slug}?window=focused`)}
              onShowInFinder={() => window.electronAPI.showInFolder(source.folderPath)}
              onDelete={() => onDeleteSource(source.config.slug)}
              onSendToWorkspace={hasOtherWorkspaces ? () => {
                setSendResourceSlug(source.config.slug)
                setSendResourceLabel(source.config.name)
                setSendDialogOpen(true)
              } : undefined}
            />
          ),
        }
      }}
    />

    {/* Send to Workspace dialog */}
    {sendResourceSlug && (
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType="source"
        resourceIds={[sendResourceSlug]}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />
    )}

    <Dialog open={anySearchDialogOpen} onOpenChange={setAnySearchDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load AnySearch MCP</DialogTitle>
          <DialogDescription>
            Enter an AnySearch API key to prepare this search connector. It stays disabled until you enable it for a workspace or task.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="anysearch-api-key">API key</Label>
            <Input
              id="anysearch-api-key"
              type="password"
              value={anySearchApiKey}
              onChange={(event) => setAnySearchApiKey(event.target.value)}
              placeholder="Enter AnySearch API key"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => window.electronAPI.openUrl(ANYSEARCH_DOCS_URL)}
            >
              Search API docs
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => window.electronAPI.openUrl(ANYSEARCH_API_KEYS_URL)}
            >
              Get API key
            </button>
          </div>

          {anySearchError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {anySearchError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setAnySearchDialogOpen(false)}>
            Skip
          </Button>
          <Button
            type="button"
            onClick={handleSaveAnySearchKey}
            disabled={anySearchLoading || !anySearchApiKey.trim()}
          >
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <KnowledgeBaseCategoryDialog
      open={!!pendingKnowledgeBaseImportPath}
      fileName={pendingKnowledgeBaseImportFileName}
      suggestedCategory={pendingKnowledgeBaseImportSuggestion}
      existingCategories={knowledgeBaseCategories}
      onOpenChange={handleCloseKnowledgeBaseImportDialog}
      onConfirm={handleConfirmKnowledgeBaseImportCategory}
    />
    </>
  )
}

function getPathFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}
