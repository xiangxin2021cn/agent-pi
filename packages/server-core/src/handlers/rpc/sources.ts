import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { CreateFileMemorySourceOptions, CreateFileMemorySourceResult } from '@craft-agent/shared/protocol'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { CONFIG_DIR, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { validateStdioMcpConnection as validateStdioMcpConnectionImpl } from '@craft-agent/shared/mcp'
import {
  isSourceUsable,
  loadSourceConfig as loadWorkspaceSourceConfig,
  loadWorkspaceSources,
  saveSourceConfig as saveWorkspaceSourceConfig,
  type FolderSourceConfig,
  type LoadedSource,
} from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import {
  ensureKnowledgeBaseIndexSourceForWorkspace,
  handleFileMemorySourceCreate,
  type FileMemorySourceCreateArgs,
  type SessionToolContext,
  type SourceConfig as SessionToolSourceConfig,
  type StdioMcpConfig,
  type StdioValidationResult,
  type ToolResult,
} from '@craft-agent/session-tools-core'
import type { HandlerDeps } from '../handler-deps'
import { prepareKnowledgeBaseFileForImport } from './knowledge-base-file-import'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.INSTALL_RECOMMENDED,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.CREATE_KNOWLEDGE_BASE_FILE_SOURCE,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
] as const

export function getMcpToolsSourceReadinessError(source: LoadedSource): string | null {
  if (!source.config.enabled) return 'Source is disabled'
  if (!isSourceUsable(source)) return 'Source requires authentication'
  if (source.config.connectionStatus === 'needs_auth') return 'Source requires authentication'
  if (source.config.connectionStatus === 'failed') return source.config.connectionError || 'Connection failed'
  if (source.config.connectionStatus === 'untested') return 'Source has not been tested yet'
  return null
}

function createWorkspaceFileMemoryToolContext(args: {
  workspaceRootPath: string
  workingDirectory: string
  knowledgeBaseRegistryRootPath: string
}): SessionToolContext {
  const { workspaceRootPath, workingDirectory, knowledgeBaseRegistryRootPath } = args

  return {
    sessionId: 'workspace-knowledge-base-import',
    workspacePath: workspaceRootPath,
    knowledgeBaseRegistryRootPath,
    get sourcesPath() { return join(workspaceRootPath, 'sources') },
    get skillsPath() { return join(workspaceRootPath, 'skills') },
    plansFolderPath: join(workspaceRootPath, 'plans'),
    workingDirectory,
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const stats = statSync(path)
        return {
          size: stats.size,
          isDirectory: () => stats.isDirectory(),
        }
      },
    },
    loadSourceConfig: (sourceSlug: string): SessionToolSourceConfig | null => {
      return loadWorkspaceSourceConfig(workspaceRootPath, sourceSlug) as unknown as SessionToolSourceConfig | null
    },
    saveSourceConfig: (source: SessionToolSourceConfig) => {
      saveWorkspaceSourceConfig(workspaceRootPath, source as unknown as FolderSourceConfig)
    },
    validateStdioMcpConnection: async (config: StdioMcpConfig): Promise<StdioValidationResult> => {
      try {
        const result = await validateStdioMcpConnectionImpl(config)
        return {
          success: result.success,
          error: result.error,
          toolCount: result.tools?.length,
          toolNames: result.tools,
          serverName: result.serverInfo?.name,
          serverVersion: result.serverInfo?.version,
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Validation failed' }
      }
    },
  }
}

function readFileMemoryCreateResult(result: ToolResult): CreateFileMemorySourceResult {
  const validationText = result.content.map(block => block.text).join('\n')
  const payload = result.structuredContent ?? {}
  const sourceSlug = typeof payload.sourceSlug === 'string'
    ? payload.sourceSlug
    : validationText.match(/^Created file memory source: (.+)$/m)?.[1]?.trim()

  if (!sourceSlug) {
    throw new Error('File memory source was created, but no source slug was returned')
  }

  return {
    sourceSlug,
    sourceConfigPath: typeof payload.sourceConfigPath === 'string' ? payload.sourceConfigPath : undefined,
    manifestPath: typeof payload.manifestPath === 'string' ? payload.manifestPath : undefined,
    chunkCount: typeof payload.chunkCount === 'number' ? payload.chunkCount : undefined,
    validationText,
    activated: payload.activated === true,
  }
}

function ensureKnowledgeBaseIndexSourceIfNeeded(workspaceRootPath: string): void {
  const registryPath = join(CONFIG_DIR, 'knowledge-base', 'registry.json')
  if (!existsSync(registryPath)) return
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as { entries?: unknown[] }
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return
  } catch {
    return
  }

  ensureKnowledgeBaseIndexSourceForWorkspace(createWorkspaceFileMemoryToolContext({
    workspaceRootPath,
    workingDirectory: workspaceRootPath,
    knowledgeBaseRegistryRootPath: CONFIG_DIR,
  }))
}

export function registerSourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get all sources for a workspace
  server.handle(RPC_CHANNELS.sources.GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    ensureKnowledgeBaseIndexSourceIfNeeded(workspace.rootPath)
    return loadWorkspaceSources(workspace.rootPath)
  })

  // Create a new source
  server.handle(RPC_CHANNELS.sources.CREATE, async (_ctx, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createSource } = await import('@craft-agent/shared/sources')
    return createSource(workspace.rootPath, {
      name: config.name || 'New Source',
      provider: config.provider || 'custom',
      type: config.type || 'mcp',
      enabled: config.enabled ?? true,
      mcp: config.mcp,
      api: config.api,
      local: config.local,
    })
  })

  // Install a recommended source template without enabling it.
  server.handle(RPC_CHANNELS.sources.INSTALL_RECOMMENDED, async (_ctx, workspaceId: string, sourceId: import('@craft-agent/shared/sources').RecommendedSourceId) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { installRecommendedSource } = await import('@craft-agent/shared/sources')
    const config = await installRecommendedSource(workspace.rootPath, sourceId)
    const sources = loadWorkspaceSources(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
    return config
  })

  server.handle(RPC_CHANNELS.sources.CREATE_KNOWLEDGE_BASE_FILE_SOURCE, async (
    _ctx,
    workspaceId: string,
    filePath: string,
    options: CreateFileMemorySourceOptions
  ): Promise<CreateFileMemorySourceResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const category = options?.knowledgeBase?.category?.trim()
    if (!category) {
      throw new Error('Knowledge base category is required')
    }

    const prepared = await prepareKnowledgeBaseFileForImport({
      filePath,
      appRootPath: CONFIG_DIR,
    })
    const toolContext = createWorkspaceFileMemoryToolContext({
      workspaceRootPath: workspace.rootPath,
      workingDirectory: dirname(prepared.filePath),
      knowledgeBaseRegistryRootPath: CONFIG_DIR,
    })
    const args: FileMemorySourceCreateArgs = {
      filePath: prepared.filePath,
      originalSourceFilePath: prepared.originalSourceFilePath,
      name: options?.name ?? basename(filePath),
      sourceSlug: options?.sourceSlug,
      chunkSize: options?.chunkSize,
      overlap: options?.overlap,
      autoEnable: options?.autoEnable ?? false,
      knowledgeBase: { category },
    }

    const result = await handleFileMemorySourceCreate(toolContext, args)
    if (result.isError) {
      const message = result.content.map(block => block.text).join('\n') || 'Failed to create knowledge base file source'
      throw new Error(message)
    }

    const created = readFileMemoryCreateResult(result)
    const sources = loadWorkspaceSources(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
    return created
  })

  // Delete a source
  server.handle(RPC_CHANNELS.sources.DELETE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteSource } = await import('@craft-agent/shared/sources')
    deleteSource(workspace.rootPath, sourceSlug)

    // Clean up stale slug from workspace default sources
    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (config?.defaults?.enabledSourceSlugs?.includes(sourceSlug)) {
      config.defaults.enabledSourceSlugs = config.defaults.enabledSourceSlugs.filter(s => s !== sourceSlug)
      saveWorkspaceConfig(workspace.rootPath, config)
    }
  })

  // Start OAuth flow for a source (DEPRECATED — use oauth:start + performOAuth client-side)
  // Kept for backward compatibility with old IPC preload; WS clients use performOAuth().
  server.handle(RPC_CHANNELS.sources.START_OAUTH, async () => {
    return {
      success: false,
      error: 'Deprecated: use the client-side performOAuth() flow (oauth:start + oauth:complete) instead',
    }
  })

  // Save credentials for a source (bearer token or API key)
  server.handle(RPC_CHANNELS.sources.SAVE_CREDENTIALS, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSource, getSourceCredentialManager, markSourceAuthenticated } = await import('@craft-agent/shared/sources')

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    // SourceCredentialManager handles credential type resolution
    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential })
    markSourceAuthenticated(workspace.rootPath, sourceSlug)

    const sources = loadWorkspaceSources(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)

    log.info(`Saved credentials for source: ${sourceSlug}`)
  })

  // Get permissions config for a source (raw format for UI display)
  server.handle(RPC_CHANNELS.sources.GET_PERMISSIONS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getSourcePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getSourcePermissionsPath(workspace.rootPath, sourceSlug)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading permissions config:', error)
      return null
    }
  })

  // Get permissions config for a workspace (raw format for UI display)
  server.handle(RPC_CHANNELS.workspace.GET_PERMISSIONS, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getWorkspacePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getWorkspacePermissionsPath(workspace.rootPath)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading workspace permissions config:', error)
      return null
    }
  })

  // Get default permissions from ~/.agent-pi/permissions/default.json
  server.handle(RPC_CHANNELS.permissions.GET_DEFAULTS, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@craft-agent/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: safeJsonParse(content), path: defaultPath }
    } catch (error) {
      log.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })

  // Get MCP tools for a source with permission status
  server.handle(RPC_CHANNELS.sources.GET_MCP_TOOLS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    try {
      const sources = await loadWorkspaceSources(workspace.rootPath)
      const source = sources.find(s => s.config.slug === sourceSlug)
      if (!source) return { success: false, error: 'Source not found' }
      if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
      if (!source.config.mcp) return { success: false, error: 'MCP config not found' }

      const readinessError = getMcpToolsSourceReadinessError(source)
      if (readinessError) return { success: false, error: readinessError }

      const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
      let client: InstanceType<typeof CraftMcpClient>

      if (source.config.mcp.transport === 'stdio') {
        if (!source.config.mcp.command) {
          return { success: false, error: 'Stdio MCP source is missing required "command" field' }
        }
        log.info(`Fetching MCP tools via stdio: ${source.config.mcp.command}`)
        client = new CraftMcpClient({
          transport: 'stdio',
          command: source.config.mcp.command,
          args: source.config.mcp.args,
          env: source.config.mcp.env,
        })
      } else {
        if (!source.config.mcp.url) {
          return { success: false, error: 'MCP source URL is required for HTTP/SSE transport' }
        }

        let accessToken: string | undefined
        if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
          const credentialManager = getCredentialManager()
          const credentialId = source.config.mcp.authType === 'oauth'
            ? { type: 'source_oauth' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
            : { type: 'source_bearer' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
          const credential = await credentialManager.get(credentialId)
          accessToken = credential?.value
        }

        log.info(`Fetching MCP tools from ${source.config.mcp.url}`)
        client = new CraftMcpClient({
          transport: 'http',
          url: source.config.mcp.url,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
      }

      const tools = await client.listTools()
      await client.close()

      const { loadSourcePermissionsConfig, permissionsConfigCache } = await import('@craft-agent/shared/agent')
      const permissionsConfig = loadSourcePermissionsConfig(workspace.rootPath, sourceSlug)

      const mergedConfig = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: workspace.rootPath,
        activeSourceSlugs: [sourceSlug],
      })

      const toolsWithPermission = tools.map(tool => {
        const allowed = mergedConfig.readOnlyMcpPatterns.some((pattern: RegExp) => pattern.test(tool.name))
        return {
          name: tool.name,
          description: tool.description,
          allowed,
        }
      })

      return { success: true, tools: toolsWithPermission }
    } catch (error) {
      log.error('Failed to get MCP tools:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
      if (errorMessage.includes('404')) {
        return { success: false, error: 'MCP server endpoint not found. The server may be offline or the URL may be incorrect.' }
      }
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return { success: false, error: 'Authentication failed. Please re-authenticate with this source.' }
      }
      return { success: false, error: errorMessage }
    }
  })
}

