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
  SettingsRow,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'
import {
  buildGoalLoopSettingsPayload,
  resolveDocumentMaxAutoVisuals,
  resolveDocumentVisualMode,
  resolveGoalLoopMaxExtraReviewers,
} from './workspace-goal-loop-settings-view-model'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'workspace',
}

type GoalLoopDefaultMode = NonNullable<NonNullable<WorkspaceSettings['goalLoop']>['defaultMode']>
type GoalLoopQualityMode = NonNullable<NonNullable<WorkspaceSettings['goalLoop']>['qualityMode']>
type DocumentVisualMode = NonNullable<NonNullable<WorkspaceSettings['goalLoop']>['documentVisualMode']>
type GoalLoopReviewerBudget = '0' | '1' | '2'
type DocumentMaxAutoVisualsOption = '0' | '3' | '5' | '8' | '12'
const MINERU_TOKEN_URL = 'https://mineru.net/apiManage/token'

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
  const [mineruEnabled, setMineruEnabled] = useState(false)
  const [mineruCleanRepeatedScanNoise, setMineruCleanRepeatedScanNoise] = useState(false)
  const [mineruTokenConfigured, setMineruTokenConfigured] = useState(false)
  const [mineruTokenDialogOpen, setMineruTokenDialogOpen] = useState(false)
  const [mineruToken, setMineruToken] = useState('')
  const [mineruTokenError, setMineruTokenError] = useState<string | null>(null)
  const [mineruTokenSaving, setMineruTokenSaving] = useState(false)
  const [mineruEnableAfterToken, setMineruEnableAfterToken] = useState(false)
  const [goalLoopDefaultMode, setGoalLoopDefaultMode] = useState<GoalLoopDefaultMode>('auto_improve')
  const [goalLoopQualityMode, setGoalLoopQualityMode] = useState<GoalLoopQualityMode>('council')
  const [goalLoopMaxExtraReviewers, setGoalLoopMaxExtraReviewers] = useState(1)
  const [goalLoopReviewerModels, setGoalLoopReviewerModels] = useState<Record<string, string> | undefined>(undefined)
  const [documentVisualMode, setDocumentVisualMode] = useState<DocumentVisualMode>('standard')
  const [documentMaxAutoVisuals, setDocumentMaxAutoVisuals] = useState(5)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true)

  // Default sources state
  const [availableSources, setAvailableSources] = useState<LoadedSource[]>([])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = useState<string[]>([])

  // Mode cycling state
  const [enabledModes, setEnabledModes] = useState<PermissionMode[]>(['safe', 'ask', 'allow-all'])
  const [modeCyclingError, setModeCyclingError] = useState<string | null>(null)

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
          setMineruEnabled(settings.documentExtraction?.mineru?.enabled ?? false)
          setMineruCleanRepeatedScanNoise(settings.documentExtraction?.mineru?.cleanRepeatedScanNoise ?? false)
          try {
            const status = await window.electronAPI.getMineruCredentialStatus(activeWorkspaceId)
            setMineruTokenConfigured(status.configured)
          } catch {
            setMineruTokenConfigured(false)
          }
          setGoalLoopDefaultMode(settings.goalLoop?.defaultMode ?? 'auto_improve')
          setGoalLoopQualityMode(settings.goalLoop?.qualityMode ?? 'council')
          setGoalLoopMaxExtraReviewers(resolveGoalLoopMaxExtraReviewers(settings.goalLoop?.maxExtraReviewers))
          setGoalLoopReviewerModels(settings.goalLoop?.reviewerModels)
          setDocumentVisualMode(resolveDocumentVisualMode(settings.goalLoop?.documentVisualMode))
          setDocumentMaxAutoVisuals(resolveDocumentMaxAutoVisuals(settings.goalLoop?.maxAutoVisuals))
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
  }, [activeWorkspaceId])

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
    }
  }, [updateWorkspaceSetting])

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
    }
  }, [updateWorkspaceSetting])

  const handleLocalMcpEnabledChange = useCallback(
    async (enabled: boolean) => {
      setLocalMcpEnabled(enabled)
      await updateWorkspaceSetting('localMcpEnabled', enabled)
    },
    [updateWorkspaceSetting]
  )

  const handleMineruEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (enabled && !mineruTokenConfigured) {
        setMineruEnableAfterToken(true)
        setMineruTokenError(null)
        setMineruTokenDialogOpen(true)
        return
      }
      setMineruEnabled(enabled)
      await updateWorkspaceSetting('documentExtraction', {
        mineru: {
          enabled,
          cleanRepeatedScanNoise: mineruCleanRepeatedScanNoise,
        },
      })
    },
    [mineruCleanRepeatedScanNoise, mineruTokenConfigured, updateWorkspaceSetting]
  )

  const handleMineruScanCleanupChange = useCallback(
    async (enabled: boolean) => {
      setMineruCleanRepeatedScanNoise(enabled)
      await updateWorkspaceSetting('documentExtraction', {
        mineru: {
          enabled: mineruEnabled,
          cleanRepeatedScanNoise: enabled,
        },
      })
    },
    [mineruEnabled, updateWorkspaceSetting]
  )

  const handleOpenMineruTokenDialog = useCallback((enableAfterSave = false) => {
    setMineruEnableAfterToken(enableAfterSave)
    setMineruToken('')
    setMineruTokenError(null)
    setMineruTokenDialogOpen(true)
  }, [])

  const handleSaveMineruToken = useCallback(async () => {
    if (!activeWorkspaceId || !window.electronAPI) return
    const trimmed = mineruToken.trim()
    if (!trimmed) {
      setMineruTokenError('MinerU token is required')
      return
    }
    setMineruTokenSaving(true)
    setMineruTokenError(null)
    try {
      const status = await window.electronAPI.saveMineruToken(activeWorkspaceId, trimmed)
      setMineruTokenConfigured(status.configured)
      setMineruToken('')
      setMineruTokenDialogOpen(false)
      if (mineruEnableAfterToken) {
        const saved = await updateWorkspaceSetting('documentExtraction', {
          mineru: {
            enabled: mineruEnableAfterToken,
            cleanRepeatedScanNoise: mineruCleanRepeatedScanNoise,
          },
        })
        if (saved) {
          setMineruEnabled(true)
        }
      }
      setMineruEnableAfterToken(false)
    } catch (error) {
      setMineruTokenError(error instanceof Error ? error.message : String(error))
    } finally {
      setMineruTokenSaving(false)
    }
  }, [activeWorkspaceId, mineruCleanRepeatedScanNoise, mineruEnableAfterToken, mineruToken, updateWorkspaceSetting])

  const handleGoalLoopDefaultModeChange = useCallback(
    async (mode: GoalLoopDefaultMode) => {
      setGoalLoopDefaultMode(mode)
      await updateWorkspaceSetting('goalLoop', buildGoalLoopSettingsPayload({
        current: {
          defaultMode: goalLoopDefaultMode,
          qualityMode: goalLoopQualityMode,
          maxExtraReviewers: goalLoopMaxExtraReviewers,
          reviewerModels: goalLoopReviewerModels,
          documentVisualMode,
          maxAutoVisuals: documentMaxAutoVisuals,
        },
        patch: { defaultMode: mode },
      }))
    },
    [documentMaxAutoVisuals, documentVisualMode, goalLoopDefaultMode, goalLoopMaxExtraReviewers, goalLoopQualityMode, goalLoopReviewerModels, updateWorkspaceSetting]
  )

  const handleGoalLoopQualityModeChange = useCallback(
    async (mode: GoalLoopQualityMode) => {
      setGoalLoopQualityMode(mode)
      await updateWorkspaceSetting('goalLoop', buildGoalLoopSettingsPayload({
        current: {
          defaultMode: goalLoopDefaultMode,
          qualityMode: goalLoopQualityMode,
          maxExtraReviewers: goalLoopMaxExtraReviewers,
          reviewerModels: goalLoopReviewerModels,
          documentVisualMode,
          maxAutoVisuals: documentMaxAutoVisuals,
        },
        patch: { qualityMode: mode },
      }))
    },
    [documentMaxAutoVisuals, documentVisualMode, goalLoopDefaultMode, goalLoopMaxExtraReviewers, goalLoopQualityMode, goalLoopReviewerModels, updateWorkspaceSetting]
  )

  const handleGoalLoopReviewerBudgetChange = useCallback(
    async (value: GoalLoopReviewerBudget) => {
      const maxExtraReviewers = Number(value)
      setGoalLoopMaxExtraReviewers(maxExtraReviewers)
      await updateWorkspaceSetting('goalLoop', buildGoalLoopSettingsPayload({
        current: {
          defaultMode: goalLoopDefaultMode,
          qualityMode: goalLoopQualityMode,
          maxExtraReviewers: goalLoopMaxExtraReviewers,
          reviewerModels: goalLoopReviewerModels,
          documentVisualMode,
          maxAutoVisuals: documentMaxAutoVisuals,
        },
        patch: { maxExtraReviewers },
      }))
    },
    [documentMaxAutoVisuals, documentVisualMode, goalLoopDefaultMode, goalLoopMaxExtraReviewers, goalLoopQualityMode, goalLoopReviewerModels, updateWorkspaceSetting]
  )

  const handleDocumentVisualModeChange = useCallback(
    async (mode: DocumentVisualMode) => {
      setDocumentVisualMode(mode)
      await updateWorkspaceSetting('goalLoop', buildGoalLoopSettingsPayload({
        current: {
          defaultMode: goalLoopDefaultMode,
          qualityMode: goalLoopQualityMode,
          maxExtraReviewers: goalLoopMaxExtraReviewers,
          reviewerModels: goalLoopReviewerModels,
          documentVisualMode,
          maxAutoVisuals: documentMaxAutoVisuals,
        },
        patch: { documentVisualMode: mode },
      }))
    },
    [documentMaxAutoVisuals, documentVisualMode, goalLoopDefaultMode, goalLoopMaxExtraReviewers, goalLoopQualityMode, goalLoopReviewerModels, updateWorkspaceSetting]
  )

  const handleDocumentMaxAutoVisualsChange = useCallback(
    async (value: DocumentMaxAutoVisualsOption) => {
      const maxAutoVisuals = Number(value)
      setDocumentMaxAutoVisuals(maxAutoVisuals)
      await updateWorkspaceSetting('goalLoop', buildGoalLoopSettingsPayload({
        current: {
          defaultMode: goalLoopDefaultMode,
          qualityMode: goalLoopQualityMode,
          maxExtraReviewers: goalLoopMaxExtraReviewers,
          reviewerModels: goalLoopReviewerModels,
          documentVisualMode,
          maxAutoVisuals: documentMaxAutoVisuals,
        },
        patch: { maxAutoVisuals },
      }))
    },
    [documentMaxAutoVisuals, documentVisualMode, goalLoopDefaultMode, goalLoopMaxExtraReviewers, goalLoopQualityMode, goalLoopReviewerModels, updateWorkspaceSetting]
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
                <SettingsMenuSelectRow
                  label={t("settings.workspace.goalLoopQuality")}
                  description={t("settings.workspace.goalLoopQualityDesc")}
                  value={goalLoopQualityMode}
                  onValueChange={(v) => handleGoalLoopQualityModeChange(v as GoalLoopQualityMode)}
                  options={[
                    { value: 'council', label: t("settings.workspace.goalLoopQualityCouncil"), description: t("settings.workspace.goalLoopQualityCouncilDesc") },
                    { value: 'standard', label: t("settings.workspace.goalLoopQualityStandard"), description: t("settings.workspace.goalLoopQualityStandardDesc") },
                  ]}
                />
                <SettingsMenuSelectRow
                  label={t("settings.workspace.goalLoopReviewerBudget")}
                  description={t("settings.workspace.goalLoopReviewerBudgetDesc")}
                  value={String(goalLoopMaxExtraReviewers)}
                  onValueChange={(v) => handleGoalLoopReviewerBudgetChange(v as GoalLoopReviewerBudget)}
                  options={[
                    { value: '1', label: t("settings.workspace.goalLoopReviewerBudgetBalanced"), description: t("settings.workspace.goalLoopReviewerBudgetBalancedDesc") },
                    { value: '0', label: t("settings.workspace.goalLoopReviewerBudgetCost"), description: t("settings.workspace.goalLoopReviewerBudgetCostDesc") },
                    { value: '2', label: t("settings.workspace.goalLoopReviewerBudgetStrict"), description: t("settings.workspace.goalLoopReviewerBudgetStrictDesc") },
                  ]}
                />
                <SettingsMenuSelectRow
                  label={t("settings.workspace.documentVisualMode")}
                  description={t("settings.workspace.documentVisualModeDesc")}
                  value={documentVisualMode}
                  onValueChange={(v) => handleDocumentVisualModeChange(v as DocumentVisualMode)}
                  options={[
                    { value: 'standard', label: t("settings.workspace.documentVisualModeStandard"), description: t("settings.workspace.documentVisualModeStandardDesc") },
                    { value: 'fast', label: t("settings.workspace.documentVisualModeFast"), description: t("settings.workspace.documentVisualModeFastDesc") },
                    { value: 'professional', label: t("settings.workspace.documentVisualModeProfessional"), description: t("settings.workspace.documentVisualModeProfessionalDesc") },
                  ]}
                />
                <SettingsMenuSelectRow
                  label={t("settings.workspace.documentMaxAutoVisuals")}
                  description={t("settings.workspace.documentMaxAutoVisualsDesc")}
                  value={String(documentMaxAutoVisuals)}
                  onValueChange={(v) => handleDocumentMaxAutoVisualsChange(v as DocumentMaxAutoVisualsOption)}
                  options={[
                    { value: '5', label: t("settings.workspace.documentMaxAutoVisualsBalanced"), description: t("settings.workspace.documentMaxAutoVisualsBalancedDesc") },
                    { value: '3', label: t("settings.workspace.documentMaxAutoVisualsLight"), description: t("settings.workspace.documentMaxAutoVisualsLightDesc") },
                    { value: '8', label: t("settings.workspace.documentMaxAutoVisualsRich"), description: t("settings.workspace.documentMaxAutoVisualsRichDesc") },
                    { value: '12', label: t("settings.workspace.documentMaxAutoVisualsMax"), description: t("settings.workspace.documentMaxAutoVisualsMaxDesc") },
                    { value: '0', label: t("settings.workspace.documentMaxAutoVisualsOff"), description: t("settings.workspace.documentMaxAutoVisualsOffDesc") },
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

            {/* Document Extraction */}
            <SettingsSection title="Document extraction">
              <SettingsCard>
                <SettingsToggle
                  label="MinerU precision extraction"
                  description="Off by default. Enable only for this workspace when you want MinerU to process uploaded PDF and scanned files."
                  checked={mineruEnabled}
                  onCheckedChange={handleMineruEnabledChange}
                />
                <SettingsRow
                  label="MinerU API token"
                  description={mineruTokenConfigured ? 'Configured in secure credential storage.' : 'Required before MinerU extraction can be enabled for this workspace.'}
                  action={
                    <button
                      type="button"
                      onClick={() => handleOpenMineruTokenDialog(false)}
                      className="inline-flex items-center h-8 px-3 text-sm rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.02] transition-colors"
                    >
                      {mineruTokenConfigured ? 'Replace' : 'Configure'}
                    </button>
                  }
                />
                <SettingsToggle
                  label="Scan cleanup"
                  description="Ask MinerU processing to clean repeated scan noise such as watermarks and signature artifacts when extraction is enabled."
                  checked={mineruCleanRepeatedScanNoise}
                  onCheckedChange={handleMineruScanCleanupChange}
                  disabled={!mineruEnabled}
                />
              </SettingsCard>
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
      <Dialog open={mineruTokenDialogOpen} onOpenChange={(open) => {
        setMineruTokenDialogOpen(open)
        if (!open) {
          setMineruEnableAfterToken(false)
          setMineruToken('')
          setMineruTokenError(null)
        }
      }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Configure MinerU token</DialogTitle>
            <DialogDescription>
              Enter a MinerU API token to prepare precision document extraction. MinerU remains disabled until you explicitly enable it for this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="mineru-token">API token</Label>
              <Input
                id="mineru-token"
                type="password"
                value={mineruToken}
                onChange={(event) => setMineruToken(event.target.value)}
                placeholder="Enter MinerU API token"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={() => window.electronAPI.openUrl(MINERU_TOKEN_URL)}
              className="text-xs text-accent hover:underline"
            >
              Get a MinerU token from the official token page
            </button>
            {mineruTokenError && (
              <div className="rounded-[8px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {mineruTokenError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMineruTokenDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveMineruToken}
              disabled={mineruTokenSaving || !mineruToken.trim()}
            >
              {mineruTokenSaving ? 'Saving...' : mineruEnableAfterToken ? 'Save and enable' : 'Save token'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
