import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getPreferencesPath, getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts, getWorkspaceByNameOrId, getDefaultThinkingLevel, setDefaultThinkingLevel } from '@craft-agent/shared/config'
import { isValidThinkingLevel, normalizeThinkingLevel, THINKING_LEVEL_IDS } from '@craft-agent/shared/agent/thinking-levels'

const VALID_THINKING_LEVELS_LIST = THINKING_LEVEL_IDS.map(id => `'${id}'`).join(', ')
import { getWorkspaceOrThrow } from '@craft-agent/server-core/handlers'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientOpenFileDialog } from '@craft-agent/server-core/transport'
import { isValidWorkingDirectory } from '../../utils/path-validation'
import type { FolderSourceConfig } from '@craft-agent/shared/sources'
import type { WorkspaceProjectMemoryConfig } from '@craft-agent/shared/workspaces'
import { GBRAIN_SOURCE_SLUG, isProjectGbrainBuildable } from '../../project-gbrain-source'
import { getProjectGbrainRuntimeStatus, initializeProjectGbrainRuntime } from '../../project-memory-lite'

export { GBRAIN_SOURCE_SLUG }

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspace.SETTINGS_GET,
  RPC_CHANNELS.workspace.SETTINGS_UPDATE,
  RPC_CHANNELS.workspace.PROJECT_GBRAIN_STATUS,
  RPC_CHANNELS.workspace.PROJECT_GBRAIN_INITIALIZE,
  RPC_CHANNELS.preferences.READ,
  RPC_CHANNELS.preferences.WRITE,
  RPC_CHANNELS.drafts.GET,
  RPC_CHANNELS.drafts.SET,
  RPC_CHANNELS.drafts.DELETE,
  RPC_CHANNELS.drafts.GET_ALL,
  RPC_CHANNELS.input.GET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.SET_AUTO_CAPITALISATION,
  RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY,
  RPC_CHANNELS.input.GET_SPELL_CHECK,
  RPC_CHANNELS.input.SET_SPELL_CHECK,
  RPC_CHANNELS.power.GET_KEEP_AWAKE,
  RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS,
  RPC_CHANNELS.caching.GET_EXTENDED_PROMPT_CACHE,
  RPC_CHANNELS.caching.SET_EXTENDED_PROMPT_CACHE,
  RPC_CHANNELS.caching.GET_ENABLE_1M_CONTEXT,
  RPC_CHANNELS.caching.SET_ENABLE_1M_CONTEXT,
  RPC_CHANNELS.rtk.GET_ENABLED,
  RPC_CHANNELS.rtk.SET_ENABLED,
  RPC_CHANNELS.rtk.GET_STATUS,
  RPC_CHANNELS.rtk.GET_GAIN,
  RPC_CHANNELS.sessions.GET_MODEL,
  RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.tools.GET_BROWSER_TOOL_ENABLED,
  RPC_CHANNELS.tools.SET_BROWSER_TOOL_ENABLED,
  RPC_CHANNELS.settings.GET_NETWORK_PROXY,
  RPC_CHANNELS.dialog.OPEN_FOLDER,
] as const

export function registerSettingsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // ============================================================
  // Settings - Default Thinking Level (App-Level)
  // ============================================================

  server.handle(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL, async () => {
    return getDefaultThinkingLevel()
  })

  server.handle(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL, async (_ctx, level: string) => {
    if (!isValidThinkingLevel(level)) {
      throw new Error(`Invalid thinking level: ${level}. Valid values: ${VALID_THINKING_LEVELS_LIST}`)
    }
    const success = setDefaultThinkingLevel(level)
    if (!success) {
      throw new Error('Failed to persist default thinking level')
    }
    return { success: true }
  })

  // ============================================================
  // Settings - Model (Session-Specific)
  // ============================================================

  // Get session-specific model
  server.handle(RPC_CHANNELS.sessions.GET_MODEL, async (_ctx, sessionId: string, _workspaceId: string): Promise<string | null> => {
    const session = await deps.sessionManager.getSession(sessionId)
    return session?.model ?? null
  })

  // Set session-specific model (and optionally connection)
  server.handle(RPC_CHANNELS.sessions.SET_MODEL, async (_ctx, sessionId: string, workspaceId: string, model: string | null, connection?: string) => {
    await deps.sessionManager.updateSessionModel(sessionId, workspaceId, model, connection)
    deps.platform.logger.info(`Session ${sessionId} model updated to: ${model}${connection ? ` (connection: ${connection})` : ''}`)
  })

  // Open native folder dialog for selecting working directory (routed to client)
  server.handle(RPC_CHANNELS.dialog.OPEN_FOLDER, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Directory',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ============================================================
  // Workspace Settings (per-workspace configuration)
  // ============================================================

  // Get workspace settings (model, permission mode, working directory, credential strategy)
  server.handle(RPC_CHANNELS.workspace.SETTINGS_GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger.error(`Workspace not found: ${workspaceId}`)
      return null
    }

    // Load workspace config
    const { loadWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)

    return {
      name: config?.name,
      model: config?.defaults?.model,
      permissionMode: config?.defaults?.permissionMode,
      cyclablePermissionModes: config?.defaults?.cyclablePermissionModes,
      thinkingLevel: normalizeThinkingLevel(config?.defaults?.thinkingLevel),
      workingDirectory: config?.defaults?.workingDirectory,
      localMcpEnabled: config?.localMcpServers?.enabled ?? true,
      defaultLlmConnection: config?.defaults?.defaultLlmConnection,
      enabledSourceSlugs: config?.defaults?.enabledSourceSlugs ?? [],
      goalLoop: config?.defaults?.goalLoop,
      projectMemory: config?.projectMemory,
    }
  })

  // Update a workspace setting
  server.handle(RPC_CHANNELS.workspace.SETTINGS_UPDATE, async (_ctx, workspaceId: string, key: string, value: unknown) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    let normalizedValue = key === 'workingDirectory' && typeof value === 'string'
      ? value.trim()
      : value

    // Validate key is a known workspace setting
    const validKeys = ['name', 'model', 'enabledSourceSlugs', 'permissionMode', 'cyclablePermissionModes', 'thinkingLevel', 'workingDirectory', 'localMcpEnabled', 'defaultLlmConnection', 'goalLoop', 'projectMemory']
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid workspace setting key: ${key}. Valid keys: ${validKeys.join(', ')}`)
    }

    if (key === 'goalLoop' && normalizedValue !== undefined && normalizedValue !== null) {
      if (typeof normalizedValue !== 'object' || Array.isArray(normalizedValue)) {
        throw new Error('goalLoop must be an object')
      }
      const defaultMode = (normalizedValue as { defaultMode?: unknown }).defaultMode
      if (defaultMode !== undefined && defaultMode !== 'off' && defaultMode !== 'check_only' && defaultMode !== 'auto_improve') {
        throw new Error('goalLoop.defaultMode must be off, check_only, or auto_improve')
      }
      normalizedValue = { defaultMode }
    }

    if (key === 'projectMemory' && normalizedValue !== undefined && normalizedValue !== null) {
      normalizedValue = normalizeProjectMemorySetting(normalizedValue)
    }

    // Validate defaultLlmConnection exists before saving
    if (key === 'defaultLlmConnection' && normalizedValue !== undefined && normalizedValue !== null) {
      const { getLlmConnection } = await import('@craft-agent/shared/config/storage')
      if (!getLlmConnection(normalizedValue as string)) {
        throw new Error(`LLM connection "${normalizedValue}" not found`)
      }
    }

    if (key === 'workingDirectory' && normalizedValue !== undefined && normalizedValue !== null) {
      const validation = isValidWorkingDirectory(String(normalizedValue))
      if (!validation.valid) {
        throw new Error(validation.reason!)
      }
    }

    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }

    // Handle 'name' specially - it's a top-level config property, not in defaults
    if (key === 'name') {
      config.name = String(normalizedValue).trim()
    } else if (key === 'localMcpEnabled') {
      // Store in localMcpServers.enabled (top-level, not in defaults)
      config.localMcpServers = config.localMcpServers || { enabled: true }
      config.localMcpServers.enabled = Boolean(normalizedValue)
    } else if (key === 'projectMemory') {
      config.projectMemory = normalizedValue as typeof config.projectMemory
      await syncGbrainSourceConfig(workspace.rootPath, config.projectMemory)
      config.defaults = config.defaults || {}
      config.defaults.enabledSourceSlugs = getGbrainDefaultSourceSlugs(config.defaults.enabledSourceSlugs, config.projectMemory)
    } else {
      // Update the setting in defaults
      config.defaults = config.defaults || {}
      ;(config.defaults as Record<string, unknown>)[key] = normalizedValue
    }

    // Save the config
    saveWorkspaceConfig(workspace.rootPath, config)
    deps.platform.logger.info(`Workspace setting updated: ${key} = ${JSON.stringify(normalizedValue)}`)
  })

  server.handle(RPC_CHANNELS.workspace.PROJECT_GBRAIN_STATUS, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    const { loadWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }
    return getProjectGbrainRuntimeStatus(config.defaults?.workingDirectory, config.projectMemory)
  })

  server.handle(RPC_CHANNELS.workspace.PROJECT_GBRAIN_INITIALIZE, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    const { loadWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (!config) {
      throw new Error(`Failed to load workspace config: ${workspaceId}`)
    }
    const result = await initializeProjectGbrainRuntime(config.defaults?.workingDirectory, config.projectMemory)
    deps.platform.logger.info(`Project gbrain initialize: workspace=${workspaceId}, status=${result.status}, initialized=${result.initialized}`)
    return result
  })

  // ============================================================
  // User Preferences
  // ============================================================

  // Read user preferences file
  server.handle(RPC_CHANNELS.preferences.READ, async () => {
    const path = getPreferencesPath()
    if (!existsSync(path)) {
      return { content: '{}', exists: false, path }
    }
    return { content: readFileSync(path, 'utf-8'), exists: true, path }
  })

  // Write user preferences file (validates JSON before saving)
  server.handle(RPC_CHANNELS.preferences.WRITE, async (_, content: string) => {
    try {
      JSON.parse(content) // Validate JSON
      const path = getPreferencesPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ============================================================
  // Session Drafts (persisted input text)
  // ============================================================

  // Get draft for a session (text + attachment refs)
  server.handle(RPC_CHANNELS.drafts.GET, async (_ctx, sessionId: string) => {
    return getSessionDraft(sessionId)
  })

  // Set draft for a session (empty drafts are cleared)
  server.handle(RPC_CHANNELS.drafts.SET, async (_ctx, sessionId: string, draft: import('@craft-agent/shared/config').SessionDraft) => {
    setSessionDraft(sessionId, draft)
  })

  // Delete draft for a session
  server.handle(RPC_CHANNELS.drafts.DELETE, async (_ctx, sessionId: string) => {
    deleteSessionDraft(sessionId)
  })

  // Get all drafts (for loading on app start)
  server.handle(RPC_CHANNELS.drafts.GET_ALL, async () => {
    return getAllSessionDrafts()
  })

  // ============================================================
  // Input Settings
  // ============================================================

  // Get auto-capitalisation setting
  server.handle(RPC_CHANNELS.input.GET_AUTO_CAPITALISATION, async () => {
    const { getAutoCapitalisation } = await import('@craft-agent/shared/config/storage')
    return getAutoCapitalisation()
  })

  // Set auto-capitalisation setting
  server.handle(RPC_CHANNELS.input.SET_AUTO_CAPITALISATION, async (_ctx, enabled: boolean) => {
    const { setAutoCapitalisation } = await import('@craft-agent/shared/config/storage')
    setAutoCapitalisation(enabled)
  })

  // Get send message key setting
  server.handle(RPC_CHANNELS.input.GET_SEND_MESSAGE_KEY, async () => {
    const { getSendMessageKey } = await import('@craft-agent/shared/config/storage')
    return getSendMessageKey()
  })

  // Set send message key setting
  server.handle(RPC_CHANNELS.input.SET_SEND_MESSAGE_KEY, async (_ctx, key: 'enter' | 'cmd-enter') => {
    const { setSendMessageKey } = await import('@craft-agent/shared/config/storage')
    setSendMessageKey(key)
  })

  // Get spell check setting
  server.handle(RPC_CHANNELS.input.GET_SPELL_CHECK, async () => {
    const { getSpellCheck } = await import('@craft-agent/shared/config/storage')
    return getSpellCheck()
  })

  // Set spell check setting
  server.handle(RPC_CHANNELS.input.SET_SPELL_CHECK, async (_ctx, enabled: boolean) => {
    const { setSpellCheck } = await import('@craft-agent/shared/config/storage')
    setSpellCheck(enabled)
  })

  // ============================================================
  // Power Settings
  // ============================================================

  // Get keep awake while running setting
  server.handle(RPC_CHANNELS.power.GET_KEEP_AWAKE, async () => {
    const { getKeepAwakeWhileRunning } = await import('@craft-agent/shared/config/storage')
    return getKeepAwakeWhileRunning()
  })

  // ============================================================
  // Appearance Settings
  // ============================================================

  // Get rich tool descriptions setting
  server.handle(RPC_CHANNELS.appearance.GET_RICH_TOOL_DESCRIPTIONS, async () => {
    const { getRichToolDescriptions } = await import('@craft-agent/shared/config/storage')
    return getRichToolDescriptions()
  })

  // Set rich tool descriptions setting
  server.handle(RPC_CHANNELS.appearance.SET_RICH_TOOL_DESCRIPTIONS, async (_ctx, enabled: boolean) => {
    const { setRichToolDescriptions } = await import('@craft-agent/shared/config/storage')
    setRichToolDescriptions(enabled)
  })

  // ============================================================
  // Prompt Caching Settings
  // ============================================================

  // Get extended prompt cache (1h TTL) setting
  server.handle(RPC_CHANNELS.caching.GET_EXTENDED_PROMPT_CACHE, async () => {
    const { getExtendedPromptCache } = await import('@craft-agent/shared/config/storage')
    return getExtendedPromptCache()
  })

  // Set extended prompt cache (1h TTL) setting
  server.handle(RPC_CHANNELS.caching.SET_EXTENDED_PROMPT_CACHE, async (_ctx, enabled: boolean) => {
    const { setExtendedPromptCache } = await import('@craft-agent/shared/config/storage')
    setExtendedPromptCache(enabled)
  })

  // Get 1M context window setting
  server.handle(RPC_CHANNELS.caching.GET_ENABLE_1M_CONTEXT, async () => {
    const { getEnable1MContext } = await import('@craft-agent/shared/config/storage')
    return getEnable1MContext()
  })

  // Set 1M context window setting
  server.handle(RPC_CHANNELS.caching.SET_ENABLE_1M_CONTEXT, async (_ctx, enabled: boolean) => {
    const { setEnable1MContext } = await import('@craft-agent/shared/config/storage')
    setEnable1MContext(enabled)
  })

  // ============================================================
  // RTK Token-Optimization Settings
  // ============================================================

  // Get rtk Bash-output compression setting
  server.handle(RPC_CHANNELS.rtk.GET_ENABLED, async () => {
    const { getRtkEnabled } = await import('@craft-agent/shared/config/storage')
    return getRtkEnabled()
  })

  // Set rtk Bash-output compression setting
  server.handle(RPC_CHANNELS.rtk.SET_ENABLED, async (_ctx, enabled: boolean) => {
    const { setRtkEnabled } = await import('@craft-agent/shared/config/storage')
    setRtkEnabled(enabled)
  })

  // Detect rtk installation (used by Settings UI to swap install prompt ↔ toggle)
  server.handle(RPC_CHANNELS.rtk.GET_STATUS, async (_ctx, opts?: { forceRecheck?: boolean }) => {
    const { getRtkStatus } = await import('@craft-agent/shared/agent')
    return getRtkStatus(opts)
  })

  // Token-savings summary from `rtk gain --format json` (efficiency meter)
  server.handle(RPC_CHANNELS.rtk.GET_GAIN, async () => {
    const { getRtkGain } = await import('@craft-agent/shared/agent')
    return getRtkGain()
  })

  // ============================================================
  // Tools Settings
  // ============================================================

  server.handle(RPC_CHANNELS.tools.GET_BROWSER_TOOL_ENABLED, async () => {
    const { getBrowserToolEnabled } = await import('@craft-agent/shared/config/storage')
    return getBrowserToolEnabled()
  })

  server.handle(RPC_CHANNELS.tools.SET_BROWSER_TOOL_ENABLED, async (_ctx, enabled: boolean) => {
    const { setBrowserToolEnabled } = await import('@craft-agent/shared/config/storage')
    setBrowserToolEnabled(enabled)
  })

  // ============================================================
  // Network Proxy Settings
  // ============================================================

  // Get network proxy settings
  server.handle(RPC_CHANNELS.settings.GET_NETWORK_PROXY, async () => {
    const { getNetworkProxySettings } = await import('@craft-agent/shared/config/storage')
    return getNetworkProxySettings()
  })
}

export function normalizeProjectMemorySetting(value: unknown): {
  gbrain?: {
    enabled?: boolean
    backend?: 'local_pglite' | 'local_postgres' | 'remote_mcp'
    localDatabasePath?: string
    postgresUrl?: string
    remoteMcpUrl?: string
  }
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('projectMemory must be an object')
  }

  const raw = value as {
    gbrain?: {
      enabled?: unknown
      backend?: unknown
      localDatabasePath?: unknown
      postgresUrl?: unknown
      remoteMcpUrl?: unknown
    }
  }

  if (raw.gbrain === undefined || raw.gbrain === null) {
    return {}
  }
  if (typeof raw.gbrain !== 'object' || Array.isArray(raw.gbrain)) {
    throw new Error('projectMemory.gbrain must be an object')
  }

  const backend = raw.gbrain.backend ?? 'local_pglite'
  if (backend !== 'local_pglite' && backend !== 'local_postgres' && backend !== 'remote_mcp') {
    throw new Error('projectMemory.gbrain.backend must be local_pglite, local_postgres, or remote_mcp')
  }

  const enabled = Boolean(raw.gbrain.enabled)
  const localDatabasePath = typeof raw.gbrain.localDatabasePath === 'string'
    ? raw.gbrain.localDatabasePath.trim()
    : undefined
  const postgresUrl = typeof raw.gbrain.postgresUrl === 'string'
    ? raw.gbrain.postgresUrl.trim()
    : undefined
  const remoteMcpUrl = typeof raw.gbrain.remoteMcpUrl === 'string'
    ? raw.gbrain.remoteMcpUrl.trim()
    : undefined

  if (postgresUrl) {
    try {
      const url = new URL(postgresUrl)
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        throw new Error('invalid protocol')
      }
    } catch {
      throw new Error('projectMemory.gbrain.postgresUrl must be a postgres connection URL')
    }
  }
  if (remoteMcpUrl) {
    try {
      const url = new URL(remoteMcpUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('invalid protocol')
      }
    } catch {
      throw new Error('projectMemory.gbrain.remoteMcpUrl must be an http(s) URL')
    }
  }
  if (enabled && backend === 'remote_mcp' && !remoteMcpUrl) {
    throw new Error('projectMemory.gbrain.remoteMcpUrl is required when remote MCP gbrain is enabled')
  }
  if (enabled && backend === 'local_postgres' && !postgresUrl) {
    throw new Error('projectMemory.gbrain.postgresUrl is required when local PostgreSQL gbrain is enabled')
  }

  return {
    gbrain: {
      enabled,
      backend,
      ...(localDatabasePath ? { localDatabasePath } : {}),
      ...(postgresUrl ? { postgresUrl } : {}),
      ...(remoteMcpUrl ? { remoteMcpUrl } : {}),
    },
  }
}

export function getGbrainDefaultSourceSlugs(
  currentSlugs: string[] | undefined,
  _projectMemory: WorkspaceProjectMemoryConfig | undefined,
): string[] {
  const slugs = new Set(currentSlugs ?? [])
  slugs.delete(GBRAIN_SOURCE_SLUG)
  return Array.from(slugs)
}

export function buildGbrainSourceConfig(
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
  previous?: FolderSourceConfig | null,
  now = Date.now(),
): FolderSourceConfig | undefined {
  const gbrain = projectMemory?.gbrain
  if (!gbrain || !isProjectGbrainBuildable(projectMemory)) return undefined

  const backend = gbrain.backend ?? 'local_pglite'
  const enabled = Boolean(gbrain.enabled)
  const createdAt = previous?.createdAt ?? now
  const base = {
    id: previous?.id ?? GBRAIN_SOURCE_SLUG,
    name: 'Project gbrain Backend',
    slug: GBRAIN_SOURCE_SLUG,
    enabled,
    provider: 'gbrain',
    type: 'mcp' as const,
    tagline: 'Project-bound graph and vector memory backend for Agent Pi.',
    createdAt,
  }

  if (backend === 'remote_mcp') {
    const remoteMcpUrl = gbrain.remoteMcpUrl?.trim()
    if (!remoteMcpUrl) return undefined
    return {
      ...base,
      isAuthenticated: previous?.mcp?.url === remoteMcpUrl ? previous?.isAuthenticated : false,
      mcp: {
        transport: 'http',
        url: remoteMcpUrl,
        authType: 'bearer',
      },
    }
  }

  return {
    ...base,
    isAuthenticated: true,
    mcp: {
      transport: 'stdio',
      command: 'gbrain',
      args: ['serve'],
      authType: 'none',
      env: {
        AGENT_PI_GBRAIN_MODE: 'project',
      },
    },
  }
}

export async function syncGbrainSourceConfig(
  workspaceRootPath: string,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
): Promise<void> {
  const { loadSourceConfig, saveSourceConfig, saveSourceGuide } = await import('@craft-agent/shared/sources')
  const previous = loadSourceConfig(workspaceRootPath, GBRAIN_SOURCE_SLUG)
  const source = buildGbrainSourceConfig(projectMemory, previous)
  if (!source) {
    if (previous?.enabled) {
      saveSourceConfig(workspaceRootPath, {
        ...previous,
        enabled: false,
        updatedAt: Date.now(),
      })
    }
    return
  }

  saveSourceConfig(workspaceRootPath, source)
  saveSourceGuide(workspaceRootPath, GBRAIN_SOURCE_SLUG, {
    raw: buildGbrainSourceGuide(source),
  })
}

function buildGbrainSourceGuide(source: FolderSourceConfig): string {
  const isRemote = source.mcp?.transport === 'http'
  return [
    '# Project gbrain Backend',
    '',
    '## Scope',
    '',
    'Use this source as the advanced memory backend for the selected project working directory. Agent Pi binds each running session to a per-working-directory namespace before starting gbrain tools.',
    '',
    '## Guidelines',
    '',
    '- Treat the selected working directory as the project boundary.',
    '- Reuse memories only within the same project namespace unless the user explicitly enables a separate company or industry knowledge source.',
    '- Prefer Project Memory Lite files under the selected working directory `.agent-pi/brain` as the inspectable source of truth.',
    '- Use gbrain search/query tools for advanced recall after checking the project boundary and source chain.',
    '- Keep write-backs concise and cite the formal output, source file, or Goal audit that produced the memory.',
    '- Do not upload secrets, private credentials, unrelated project files, or unaudited scratch outputs into gbrain.',
    '',
    '## Context',
    '',
    isRemote
      ? 'This source connects to a remote gbrain MCP endpoint. Runtime requests include project namespace headers; if tools report authentication failure, save a bearer token for this source before retrying.'
      : 'This source starts local gbrain through `gbrain serve`. Runtime sessions set `GBRAIN_HOME`, `GBRAIN_NAMESPACE`, `GBRAIN_SOURCE`, and any project-specific PostgreSQL database URL from the selected working directory.',
    '',
  ].join('\n')
}
