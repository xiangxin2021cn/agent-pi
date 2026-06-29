/**
 * WorkspaceSettingsPage
 *
 * Workspace-level settings for the active workspace.
 *
 * Settings:
 * - Identity (Name, Icon)
 * - Permissions (Default mode, Mode cycling)
 * - Advanced (Working directory, Local MCP servers)
 *
 * Note: AI settings (model, thinking, connection) have been moved to AiSettingsPage.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import { RenameDialog } from '@/components/ui/rename-dialog'
import type { PermissionMode, WorkspaceSettings, LoadedSource } from '../../../shared/types'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { ServerDirectoryBrowser } from '@/components/ServerDirectoryBrowser'
import { PERMISSION_MODE_CONFIG } from '@craft-agent/shared/agent/mode-types'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { toast } from 'sonner'

import {
  SettingsSection,
  SettingsCard,
  SettingsInputRow,
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import type { ProjectGbrainStatusResult } from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'workspace',
}

type GoalLoopDefaultMode = NonNullable<NonNullable<WorkspaceSettings['goalLoop']>['defaultMode']>
type GbrainBackend = NonNullable<NonNullable<NonNullable<WorkspaceSettings['projectMemory']>['gbrain']>['backend']>

// ============================================
// Main Component
// ============================================

export default function WorkspaceSettingsPage() {
  const { t } = useTranslation()

  // Get active workspace from context
  const appShellContext = useAppShellContext()
  const activeWorkspaceId = appShellContext.activeWorkspaceId
  const onRefreshWorkspaces = appShellContext.onRefreshWorkspaces

  // Workspace settings state
  const [wsName, setWsName] = useState('')
  const [wsNameEditing, setWsNameEditing] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [wsIconUrl, setWsIconUrl] = useState<string | null>(null)
  const [isUploadingIcon, setIsUploadingIcon] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)
  const [goalLoopDefaultMode, setGoalLoopDefaultMode] = useState<GoalLoopDefaultMode>('auto_improve')
  const [gbrainEnabled, setGbrainEnabled] = useState(false)
  const [gbrainBackend, setGbrainBackend] = useState<GbrainBackend>('local_pglite')
  const [gbrainLocalDatabasePath, setGbrainLocalDatabasePath] = useState('')
  const [gbrainPostgresUrl, setGbrainPostgresUrl] = useState('')
  const [gbrainRemoteMcpUrl, setGbrainRemoteMcpUrl] = useState('')
  const [projectGbrainStatus, setProjectGbrainStatus] = useState<ProjectGbrainStatusResult | null>(null)
  const [isCheckingProjectGbrain, setIsCheckingProjectGbrain] = useState(false)
  const [isInitializingProjectGbrain, setIsInitializingProjectGbrain] = useState(false)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Default sources state
  const [availableSources, setAvailableSources] = useState<LoadedSource[]>([])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])

  // Mode cycling state
  const [enabledModes, setEnabledModes] = useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  const [modeCyclingError, setModeCyclingError] = useState<string | null>(null)

  const refreshProjectGbrainStatus = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) {
      setProjectGbrainStatus(null)
      return
    }

    setIsCheckingProjectGbrain(true)
    try {
      setProjectGbrainStatus(await window.electronAPI.getProjectGbrainStatus(activeWorkspaceId))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setProjectGbrainStatus(null)
      toast.error(t('settings.workspace.projectMemoryGbrainStatusFailed', { defaultValue: 'Failed to check project gbrain status' }), {
        description: message,
      })
    } finally {
      setIsCheckingProjectGbrain(false)
    }
  }, [activeWorkspaceId, t])

  // Load workspace settings when active workspace changes
  useEffect(() => {
    const loadWorkspaceSettings = async () => {
      if (!window.electronAPI || !activeWorkspaceId) {
        setIsLoadingWorkspace(false)
        return
      }

      setIsLoadingWorkspace(true)
      try {
        const settings = await window.electronAPI.getWorkspaceSettings(activeWorkspaceId)
        if (settings) {
          setWsName(settings.name || '')
          setWsNameEditing(settings.name || '')
          setPermissionMode(settings.permissionMode || 'ask')
          setWorkingDirectory(settings.workingDirectory || '')
          setLocalMcpEnabled(settings.localMcpEnabled ?? true)
          setGoalLoopDefaultMode(settings.goalLoop?.defaultMode ?? 'auto_improve')
          setGbrainEnabled(settings.projectMemory?.gbrain?.enabled ?? false)
          setGbrainBackend(settings.projectMemory?.gbrain?.backend ?? 'local_pglite')
          setGbrainLocalDatabasePath(settings.projectMemory?.gbrain?.localDatabasePath ?? '')
          setGbrainPostgresUrl(settings.projectMemory?.gbrain?.postgresUrl ?? '')
          setGbrainRemoteMcpUrl(settings.projectMemory?.gbrain?.remoteMcpUrl ?? '')
          // Load cyclable permission modes from workspace settings
          if (settings.cyclablePermissionModes && settings.cyclablePermissionModes.length >= 2) {
            setEnabledModes(settings.cyclablePermissionModes)
          }

          // Load default source slugs
          const savedSlugs = settings.enabledSourceSlugs ?? []

          // Load available sources and auto-heal stale slugs
          const sources = await window.electronAPI.getSources(activeWorkspaceId)
          setAvailableSources(sources)
          const validSlugs = new Set(sources.map(s => s.config.slug))
          const healedSlugs = savedSlugs.filter(s => validSlugs.has(s))
          setEnabledSourceSlugs(healedSlugs)

          // Persist cleaned list if stale slugs were removed
          if (healedSlugs.length !== savedSlugs.length) {
            window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, 'enabledSourceSlugs', healedSlugs)
          }

          void refreshProjectGbrainStatus()
        }

        // Try to load workspace icon (check common extensions)
        const ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif']
        let iconFound = false
        for (const ext of ICON_EXTENSIONS) {
          try {
            const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
            // IPC returns null for missing files - continue to next extension
            if (!iconData) {
              continue
            }
            // For SVG, wrap in data URL
            if (ext === 'svg' && !iconData.startsWith('data:')) {
              setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
            } else {
              setWsIconUrl(iconData)
            }
            iconFound = true
            break
          } catch {
            // Icon not found with this extension, try next
          }
        }
        if (!iconFound) {
          setWsIconUrl(null)
        }
      } catch (error) {
        console.error('Failed to load workspace settings:', error)
      } finally {
        setIsLoadingWorkspace(false)
      }
    }

    loadWorkspaceSettings()
  }, [activeWorkspaceId, refreshProjectGbrainStatus])

  // Subscribe to live source changes (additions/removals)
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onSourcesChanged((workspaceId: string, sources: LoadedSource[]) => {
      if (workspaceId !== activeWorkspaceId) return
      setAvailableSources(sources)
      // Auto-heal: remove slugs for sources that no longer exist
      const validSlugs = new Set(sources.map(s => s.config.slug))
      setEnabledSourceSlugs(prev => {
        const healed = prev.filter(s => validSlugs.has(s))
        if (healed.length !== prev.length && activeWorkspaceId) {
          window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, 'enabledSourceSlugs', healed)
        }
        return healed
      })
    })
    return cleanup
  }, [activeWorkspaceId])

  // Save workspace setting
  const updateWorkspaceSetting = useCallback(
    async <K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) => {
      if (!window.electronAPI || !activeWorkspaceId) return false

      try {
        await window.electronAPI.updateWorkspaceSetting(activeWorkspaceId, key, value)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error(`Failed to save ${String(key)}:`, error)
        toast.error(t("settings.workspace.failedToSave", { setting: String(key) }), {
          description: message,
        })
        return false
      }
    },
    [activeWorkspaceId, t]
  )

  // Workspace icon upload handler
  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeWorkspaceId || !window.electronAPI) return

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) {
      console.error('Invalid file type:', file.type)
      return
    }

    setIsUploadingIcon(true)
    try {
      // Read file as base64
      const buffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )

      // Determine extension from mime type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/svg+xml': 'svg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      }
      const ext = extMap[file.type] || 'png'

      // Upload to workspace
      await window.electronAPI.writeWorkspaceImage(activeWorkspaceId, `./icon.${ext}`, base64, file.type)

      // Reload the icon locally for settings display
      const iconData = await window.electronAPI.readWorkspaceImage(activeWorkspaceId, `./icon.${ext}`)
      if (iconData) {
        if (ext === 'svg' && !iconData.startsWith('data:')) {
          setWsIconUrl(`data:image/svg+xml;base64,${btoa(iconData)}`)
        } else {
          setWsIconUrl(iconData)
        }
      }

      // Refresh workspaces to update sidebar icon
      onRefreshWorkspaces?.()
    } catch (error) {
      console.error('Failed to upload icon:', error)
    } finally {
      setIsUploadingIcon(false)
      // Reset the input so the same file can be selected again
      e.target.value = ''
    }
  }, [activeWorkspaceId, onRefreshWorkspaces])

  // Workspace settings handlers
  const handlePermissionModeChange = useCallback(
    async (newMode: PermissionMode) => {
      setPermissionMode(newMode)
      await updateWorkspaceSetting('permissionMode', newMode)
    },
    [updateWorkspaceSetting]
  )

  const handleWorkingDirectorySelected = useCallback(async (selectedPath: string) => {
    const saved = await updateWorkspaceSetting('workingDirectory', selectedPath)
    if (saved) {
      setWorkingDirectory(selectedPath)
      void refreshProjectGbrainStatus()
    }
  }, [refreshProjectGbrainStatus, updateWorkspaceSetting])

  const {
    pickDirectory: handleChangeWorkingDirectory,
    showServerBrowser: showWdBrowser,
    serverBrowserMode: wdBrowserMode,
    cancelServerBrowser: cancelWdBrowser,
    confirmServerBrowser: confirmWdBrowser,
  } = useDirectoryPicker(handleWorkingDirectorySelected)

  const handleClearWorkingDirectory = useCallback(async () => {
    if (!window.electronAPI) return

    const saved = await updateWorkspaceSetting('workingDirectory', undefined)
    if (saved) {
      setWorkingDirectory('')
      void refreshProjectGbrainStatus()
    }
  }, [refreshProjectGbrainStatus, updateWorkspaceSetting])

  const handleLocalMcpEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalMcpEnabled(enabled)
      await updateWorkspaceSetting('localMcpEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const saveProjectMemorySetting = useCallback(async (patch: Partial<NonNullable<WorkspaceSettings['projectMemory']>['gbrain']>) => {
    const nextGbrain = {
      enabled: gbrainEnabled,
      backend: gbrainBackend,
      localDatabasePath: gbrainLocalDatabasePath,
      postgresUrl: gbrainPostgresUrl,
      remoteMcpUrl: gbrainRemoteMcpUrl,
      ...patch,
    }

    const saved = await updateWorkspaceSetting('projectMemory', {
      gbrain: nextGbrain,
    })
    if (saved) void refreshProjectGbrainStatus()
    return saved
  }, [gbrainBackend, gbrainEnabled, gbrainLocalDatabasePath, gbrainPostgresUrl, gbrainRemoteMcpUrl, refreshProjectGbrainStatus, updateWorkspaceSetting])

  const handleGbrainEnabledChange = useCallback(async (enabled: boolean) => {
    setGbrainEnabled(enabled)
    const saved = await saveProjectMemorySetting({ enabled })
    if (!saved) setGbrainEnabled(!enabled)
  }, [saveProjectMemorySetting])

  const handleGbrainBackendChange = useCallback(async (backend: GbrainBackend) => {
    setGbrainBackend(backend)
    const saved = await saveProjectMemorySetting({ backend })
    if (!saved) setGbrainBackend(gbrainBackend)
  }, [gbrainBackend, saveProjectMemorySetting])

  const handleGbrainLocalDatabasePathBlur = useCallback(async () => {
    await saveProjectMemorySetting({ localDatabasePath: gbrainLocalDatabasePath })
  }, [gbrainLocalDatabasePath, saveProjectMemorySetting])

  const handleGbrainPostgresUrlBlur = useCallback(async () => {
    await saveProjectMemorySetting({ postgresUrl: gbrainPostgresUrl })
  }, [gbrainPostgresUrl, saveProjectMemorySetting])

  const handleGbrainRemoteMcpUrlBlur = useCallback(async () => {
    await saveProjectMemorySetting({ remoteMcpUrl: gbrainRemoteMcpUrl })
  }, [gbrainRemoteMcpUrl, saveProjectMemorySetting])

  const handleInitializeProjectGbrain = useCallback(async () => {
    if (!window.electronAPI || !activeWorkspaceId) return

    setIsInitializingProjectGbrain(true)
    try {
      const result = await window.electronAPI.initializeProjectGbrain(activeWorkspaceId)
      setProjectGbrainStatus(result)
      if (result.initialized) {
        toast.success(t('settings.workspace.projectMemoryGbrainInitialized', { defaultValue: 'Project gbrain initialized' }))
      } else {
        toast.error(t('settings.workspace.projectMemoryGbrainInitializeIncomplete', { defaultValue: 'Project gbrain is not ready yet' }), {
          description: result.message,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('settings.workspace.projectMemoryGbrainInitializeFailed', { defaultValue: 'Failed to initialize project gbrain' }), {
        description: message,
      })
    } finally {
      setIsInitializingProjectGbrain(false)
    }
  }, [activeWorkspaceId, t])

  const handleGoalLoopDefaultModeChange = useCallback(
    async (mode: GoalLoopDefaultMode) => {
      setGoalLoopDefaultMode(mode)
      await updateWorkspaceSetting('goalLoop', { defaultMode: mode })
    },
    [updateWorkspaceSetting]
  )

  const handleSourceToggle = useCallback(
    async (slug: string, checked: boolean) => {
      const newSlugs = checked
        ? [...enabledSourceSlugs, slug]
        : enabledSourceSlugs.filter(s => s !== slug)
      setEnabledSourceSlugs(newSlugs)
      await updateWorkspaceSetting('enabledSourceSlugs', newSlugs)
    },
    [enabledSourceSlugs, updateWorkspaceSetting]
  )

  const handleModeToggle = useCallback(
    async (mode: PermissionMode, checked: boolean) => {
      if (!window.electronAPI) return

      // Calculate what the new modes would be
      const newModes = checked
        ? [...enabledModes, mode]
        : enabledModes.filter((m) => m !== mode)

      // Validate: at least 2 modes required
      if (newModes.length < 2) {
        setModeCyclingError(t('settings.workspace.atLeast2Modes'))
        // Auto-dismiss after 2 seconds
        setTimeout(() => {
          setModeCyclingError(null)
        }, 2000)
        return
      }

      // Update state and persist
      setEnabledModes(newModes)
      setModeCyclingError(null)
      try {
        await updateWorkspaceSetting('cyclablePermissionModes', newModes)
      } catch (error) {
        console.error('Failed to save mode cycling settings:', error)
      }
    },
    [enabledModes, updateWorkspaceSetting, t]
  )

  const projectGbrainStatusDescription = projectGbrainStatus
    ? [
        projectGbrainStatus.message,
        projectGbrainStatus.namespace ? `Namespace: ${projectGbrainStatus.namespace}` : undefined,
        projectGbrainStatus.projectGbrainPath ? `Store: ${projectGbrainStatus.projectGbrainPath}` : undefined,
      ].filter(Boolean).join(' ')
    : t('settings.workspace.projectMemoryGbrainStatusDesc', { defaultValue: 'Check the selected working directory project memory backend.' })
  const canInitializeProjectGbrain = Boolean(projectGbrainStatus?.canInitialize && gbrainEnabled && (gbrainBackend === 'local_pglite' || gbrainBackend === 'local_postgres'))

  // Show empty state if no workspace is active
  if (!activeWorkspaceId) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">{t("settings.workspace.noWorkspaceSelected")}</p>
        </div>
      </div>
    )
  }

  // Show loading state
  if (isLoadingWorkspace) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t("settings.workspace.workspaceSettings")} actions={<HeaderMenu route={routes.view.settings('workspace')} helpFeature="workspaces" />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
          <div className="space-y-8">
            {/* Workspace Info */}
            <SettingsSection title={t("settings.workspace.workspaceInfo")}>
              <SettingsCard>
                <SettingsRow
                  label={t("common.name")}
                  description={wsName || t("settings.workspace.untitled")}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setWsNameEditing(wsName)
                        setRenameDialogOpen(true)
                      }}
                      className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                    >
                      {t("common.edit")}
                    </button>
                  }
                />
                <SettingsRow
                  label={t("settings.workspace.icon")}
                  action={
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                        onChange={handleIconUpload}
                        className="sr-only"
                        disabled={isUploadingIcon}
                      />
                      <span className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors">
                        {isUploadingIcon ? t("common.uploading") : t("common.change")}
                      </span>
                    </label>
                  }
                >
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full overflow-hidden bg-foreground/5 flex items-center justify-center',
                      'ring-1 ring-border/50'
                    )}
                  >
                    {isUploadingIcon ? (
                      <Spinner className="text-muted-foreground text-[8px]" />
                    ) : wsIconUrl ? (
                      <img src={wsIconUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {wsName?.charAt(0)?.toUpperCase() || 'W'}
                      </span>
                    )}
                  </div>
                </SettingsRow>
              </SettingsCard>

              <RenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                title={t("settings.workspace.renameWorkspace")}
                value={wsNameEditing}
                onValueChange={setWsNameEditing}
                onSubmit={() => {
                  const newName = wsNameEditing.trim()
                  if (newName && newName !== wsName) {
                    setWsName(newName)
                    updateWorkspaceSetting('name', newName)
                    onRefreshWorkspaces?.()
                  }
                  setRenameDialogOpen(false)
                }}
                placeholder={t("settings.workspace.enterWorkspaceName")}
              />
            </SettingsSection>

            {/* Permissions */}
            <SettingsSection title={t("settings.workspace.permissionsSection")}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={t("settings.workspace.defaultMode")}
                  description={t("settings.workspace.defaultModeDesc")}
                  value={permissionMode}
                  onValueChange={(v) => handlePermissionModeChange(v as PermissionMode)}
                  options={[
                    { value: 'safe', label: t("mode.explore"), description: t("mode.exploreDesc") },
                    { value: 'ask', label: t("mode.ask"), description: t("mode.askDesc") },
                    { value: 'allow-all', label: t("mode.execute"), description: t("mode.executeDesc") },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Goal Loop */}
            <SettingsSection title={t("settings.workspace.goalLoop")}>
              <SettingsCard>
                <SettingsMenuSelectRow
                  label={t("settings.workspace.goalLoopDefault")}
                  description={t("settings.workspace.goalLoopDefaultDesc")}
                  value={goalLoopDefaultMode}
                  onValueChange={(v) => handleGoalLoopDefaultModeChange(v as GoalLoopDefaultMode)}
                  options={[
                    { value: 'auto_improve', label: t("settings.workspace.goalLoopAutoImprove"), description: t("settings.workspace.goalLoopAutoImproveDesc") },
                    { value: 'check_only', label: t("settings.workspace.goalLoopCheckOnly"), description: t("settings.workspace.goalLoopCheckOnlyDesc") },
                    { value: 'off', label: t("settings.workspace.goalLoopOff"), description: t("settings.workspace.goalLoopOffDesc") },
                  ]}
                />
              </SettingsCard>
            </SettingsSection>

            {/* Mode Cycling */}
            <SettingsSection
              title={t("settings.workspace.modeCycling")}
              description={t("settings.workspace.modeCyclingDesc")}
            >
              <SettingsCard>
                {(['safe', 'ask', 'allow-all'] as const).map((m) => {
                  const modeTranslations: Record<string, { label: string; desc: string }> = {
                    'safe': { label: t("mode.explore"), desc: t("mode.exploreFullDesc") },
                    'ask': { label: t("mode.askToEdit"), desc: t("mode.askFullDesc") },
                    'allow-all': { label: t("mode.execute"), desc: t("mode.executeFullDesc") },
                  }
                  const isEnabled = enabledModes.includes(m)
                  return (
                    <SettingsToggle
                      key={m}
                      label={modeTranslations[m].label}
                      description={modeTranslations[m].desc}
                      checked={isEnabled}
                      onCheckedChange={(checked) => handleModeToggle(m, checked)}
                    />
                  )
                })}
              </SettingsCard>
              <AnimatePresence>
                {modeCyclingError && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="text-xs text-destructive mt-1 overflow-hidden"
                  >
                    {modeCyclingError}
                  </motion.p>
                )}
              </AnimatePresence>
            </SettingsSection>

            {/* Default Sources */}
            <SettingsSection
              title={t("settings.workspace.defaultSources")}
              description={t("settings.workspace.defaultSourcesDesc")}
            >
              {availableSources.length > 0 ? (
                <SettingsCard>
                  {availableSources.map((source) => (
                    <SettingsToggle
                      key={source.config.slug}
                      label={
                        <span className="inline-flex items-center gap-2">
                          <SourceAvatar source={source} size="xs" />
                          {source.config.name}
                        </span>
                      }
                      description={source.config.tagline}
                      checked={enabledSourceSlugs.includes(source.config.slug)}
                      onCheckedChange={(checked) => handleSourceToggle(source.config.slug, checked)}
                    />
                  ))}
                </SettingsCard>
              ) : (
                <p className="text-sm text-muted-foreground">{t("settings.workspace.noSourcesConfigured")}</p>
              )}
            </SettingsSection>

            {/* Advanced */}
            <SettingsSection title={t("settings.workspace.advanced")}>
              <SettingsCard>
                <SettingsRow
                  label={t("settings.workspace.defaultWorkingDir")}
                  description={workingDirectory || t("settings.workspace.defaultWorkingDirDesc")}
                  action={
                    <div className="flex items-center gap-2">
                      {workingDirectory && (
                        <button
                          type="button"
                          onClick={handleClearWorkingDirectory}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors text-foreground/60 hover:text-foreground"
                        >
                          {t("common.clear")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleChangeWorkingDirectory}
                        className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                      >
                        {t("common.change")}
                      </button>
                    </div>
                  }
                />
                <SettingsToggle
                  label={t("settings.workspace.localMcpServers")}
                  description={t("settings.workspace.localMcpServersDesc")}
                  checked={localMcpEnabled}
                  onCheckedChange={handleLocalMcpEnabledChange}
                />
                <SettingsToggle
                  label={t('settings.workspace.projectMemoryGbrain', { defaultValue: 'Project gbrain backend' })}
                  description={t('settings.workspace.projectMemoryGbrainDesc', { defaultValue: 'Project-level graph/vector memory bound to each working directory. Use separate sources for company or industry knowledge.' })}
                  checked={gbrainEnabled}
                  onCheckedChange={handleGbrainEnabledChange}
                />
                <SettingsMenuSelectRow
                  label={t('settings.workspace.projectMemoryGbrainBackend', { defaultValue: 'gbrain backend' })}
                  description={t('settings.workspace.projectMemoryGbrainBackendDesc', { defaultValue: 'Choose local PGLite or remote MCP; Agent Pi injects a per-working-directory namespace.' })}
                  value={gbrainBackend}
                  onValueChange={(v) => handleGbrainBackendChange(v as GbrainBackend)}
                  options={[
                    { value: 'local_pglite', label: t('settings.workspace.projectMemoryGbrainLocalPglite', { defaultValue: 'Local PGLite' }), description: t('settings.workspace.projectMemoryGbrainLocalPgliteDesc', { defaultValue: 'Use a project-isolated local gbrain store.' }) },
                    { value: 'local_postgres', label: t('settings.workspace.projectMemoryGbrainLocalPostgres', { defaultValue: 'Local PostgreSQL' }), description: t('settings.workspace.projectMemoryGbrainLocalPostgresDesc', { defaultValue: 'Use local PostgreSQL + pgvector with one derived gbrain database per project working directory.' }) },
                    { value: 'remote_mcp', label: t('settings.workspace.projectMemoryGbrainRemoteMcp', { defaultValue: 'Remote MCP' }), description: t('settings.workspace.projectMemoryGbrainRemoteMcpDesc', { defaultValue: 'Connect to a gbrain-compatible remote MCP service with project namespace headers.' }) },
                  ]}
                />
                {gbrainBackend === 'local_pglite' ? (
                  <SettingsInputRow
                    label={t('settings.workspace.projectMemoryGbrainLocalPath', { defaultValue: 'Local gbrain base folder' })}
                    description={t('settings.workspace.projectMemoryGbrainLocalPathDesc', { defaultValue: 'Optional base folder for project gbrain stores. Defaults to <workingDirectory>/.agent-pi/gbrain.' })}
                    value={gbrainLocalDatabasePath}
                    onChange={setGbrainLocalDatabasePath}
                    onBlur={handleGbrainLocalDatabasePathBlur}
                    placeholder="Uses <workingDirectory>/.agent-pi/gbrain"
                  />
                ) : gbrainBackend === 'local_postgres' ? (
                  <SettingsInputRow
                    label={t('settings.workspace.projectMemoryGbrainPostgresUrl', { defaultValue: 'PostgreSQL URL' })}
                    description={t('settings.workspace.projectMemoryGbrainPostgresUrlDesc', { defaultValue: 'PostgreSQL service URL used as a template. Agent Pi derives a separate database per project working directory, for example agent_pi_gbrain_<project-hash>.' })}
                    value={gbrainPostgresUrl}
                    onChange={setGbrainPostgresUrl}
                    onBlur={handleGbrainPostgresUrlBlur}
                    placeholder="postgres://user:password@127.0.0.1:5433/agent_pi_gbrain"
                    type="password"
                  />
                ) : (
                  <SettingsInputRow
                    label={t('settings.workspace.projectMemoryGbrainRemoteUrl', { defaultValue: 'Remote MCP URL' })}
                    description={t('settings.workspace.projectMemoryGbrainRemoteUrlDesc', { defaultValue: 'Required when remote MCP is enabled. Use an http(s) gbrain MCP endpoint; bearer auth is handled by the generated source.' })}
                    value={gbrainRemoteMcpUrl}
                    onChange={setGbrainRemoteMcpUrl}
                    onBlur={handleGbrainRemoteMcpUrlBlur}
                    placeholder="https://example.com/mcp"
                    type="url"
                  />
                )}
                <SettingsRow
                  label={t('settings.workspace.projectMemoryGbrainStatus', { defaultValue: 'Project gbrain status' })}
                  description={projectGbrainStatusDescription}
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={refreshProjectGbrainStatus}
                        disabled={isCheckingProjectGbrain || isInitializingProjectGbrain}
                        className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors disabled:opacity-50"
                      >
                        {isCheckingProjectGbrain ? t('common.checking', { defaultValue: 'Checking' }) : t('common.check', { defaultValue: 'Check' })}
                      </button>
                      {canInitializeProjectGbrain && (
                        <button
                          type="button"
                          onClick={handleInitializeProjectGbrain}
                          disabled={isInitializingProjectGbrain || isCheckingProjectGbrain}
                          className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          {isInitializingProjectGbrain ? t('common.initializing', { defaultValue: 'Initializing' }) : t('common.initialize', { defaultValue: 'Initialize' })}
                        </button>
                      )}
                    </div>
                  }
                />
              </SettingsCard>
            </SettingsSection>

          </div>
        </div>
        </ScrollArea>
      </div>
      <ServerDirectoryBrowser
        open={showWdBrowser}
        mode={wdBrowserMode}
        onSelect={confirmWdBrowser}
        onCancel={cancelWdBrowser}
        initialPath={workingDirectory || undefined}
      />
    </div>
  )
}
