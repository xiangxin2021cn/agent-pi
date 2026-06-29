import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import type { LoadedSource } from '@craft-agent/shared/sources'
import { getProjectBrainPath } from '@craft-agent/shared/sessions'
import type { WorkspaceProjectMemoryConfig } from '@craft-agent/shared/workspaces'

export const GBRAIN_SOURCE_SLUG = 'agent-pi-gbrain'

export interface ProjectGbrainContext {
  workingDirectory: string
  namespace: string
  projectBrainPath: string
  projectGbrainPath: string
  postgresDatabaseName?: string
  postgresDatabaseUrl?: string
}

export function isProjectGbrainBuildable(projectMemory: WorkspaceProjectMemoryConfig | undefined): boolean {
  const gbrain = projectMemory?.gbrain
  if (!gbrain?.enabled) return false
  if ((gbrain.backend ?? 'local_pglite') === 'local_postgres') {
    return Boolean(gbrain.postgresUrl?.trim())
  }
  if ((gbrain.backend ?? 'local_pglite') === 'remote_mcp') {
    return Boolean(gbrain.remoteMcpUrl?.trim())
  }
  return true
}

export function getProjectGbrainSessionSourceSlugs(
  currentSlugs: string[] | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
  workingDirectory: string | undefined,
): string[] {
  const slugs = new Set((currentSlugs ?? []).filter(Boolean))
  slugs.delete(GBRAIN_SOURCE_SLUG)
  if (workingDirectory && isProjectGbrainBuildable(projectMemory)) {
    slugs.add(GBRAIN_SOURCE_SLUG)
  }
  return Array.from(slugs)
}

export function normalizeProjectRootForNamespace(workingDirectory: string): string {
  const normalized = resolve(workingDirectory)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function getProjectGbrainNamespace(workingDirectory: string): string {
  const hash = createHash('sha256')
    .update(normalizeProjectRootForNamespace(workingDirectory))
    .digest('hex')
    .slice(0, 16)
  return `project-${hash}`
}

export function getProjectGbrainPostgresDatabaseName(
  workingDirectory: string,
  postgresUrl: string | undefined,
): string {
  const namespaceSuffix = getProjectGbrainNamespace(workingDirectory).replace(/^project-/, '')
  const baseName = getConfiguredPostgresDatabaseName(postgresUrl)
  const prefix = sanitizePostgresDatabaseName(baseName && baseName !== 'postgres' && baseName !== 'template1'
    ? baseName
    : 'agent_pi_gbrain')
  const maxPrefixLength = Math.max(1, 63 - namespaceSuffix.length - 1)
  return `${prefix.slice(0, maxPrefixLength)}_${namespaceSuffix}`
}

export function getProjectGbrainPostgresDatabaseUrl(
  workingDirectory: string,
  postgresUrl: string | undefined,
): string | undefined {
  const trimmed = postgresUrl?.trim()
  if (!trimmed) return undefined

  const url = new URL(trimmed)
  url.pathname = `/${getProjectGbrainPostgresDatabaseName(workingDirectory, trimmed)}`
  return url.toString()
}

export function getProjectGbrainContext(
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
): ProjectGbrainContext | undefined {
  if (!workingDirectory || !isProjectGbrainBuildable(projectMemory)) return undefined

  const projectBrainPath = getProjectBrainPath(workingDirectory)
  if (!projectBrainPath) return undefined

  const namespace = getProjectGbrainNamespace(workingDirectory)
  const configuredBase = projectMemory?.gbrain?.localDatabasePath?.trim()
  const projectGbrainPath = configuredBase
    ? join(configuredBase, namespace)
    : join(workingDirectory, '.agent-pi', 'gbrain')
  const postgresDatabaseUrl = projectMemory?.gbrain?.backend === 'local_postgres'
    ? getProjectGbrainPostgresDatabaseUrl(workingDirectory, projectMemory.gbrain.postgresUrl)
    : undefined
  const postgresDatabaseName = projectMemory?.gbrain?.backend === 'local_postgres'
    ? getProjectGbrainPostgresDatabaseName(workingDirectory, projectMemory.gbrain.postgresUrl)
    : undefined

  return {
    workingDirectory,
    namespace,
    projectBrainPath,
    projectGbrainPath,
    ...(postgresDatabaseName ? { postgresDatabaseName } : {}),
    ...(postgresDatabaseUrl ? { postgresDatabaseUrl } : {}),
  }
}

export async function ensureProjectGbrainStore(
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
): Promise<void> {
  const context = getProjectGbrainContext(workingDirectory, projectMemory)
  if (!context) return
  await mkdir(context.projectGbrainPath, { recursive: true })
}

export function withProjectGbrainSourcesContext(
  sources: LoadedSource[],
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
): LoadedSource[] {
  return sources.map(source => withProjectGbrainSourceContext(source, workingDirectory, projectMemory))
}

export function withProjectGbrainSourceContext(
  source: LoadedSource,
  workingDirectory: string | undefined,
  projectMemory: WorkspaceProjectMemoryConfig | undefined,
): LoadedSource {
  if (source.config.slug !== GBRAIN_SOURCE_SLUG || source.config.type !== 'mcp') return source

  const context = getProjectGbrainContext(workingDirectory, projectMemory)
  if (!context || !source.config.mcp) {
    return {
      ...source,
      config: {
        ...source.config,
        enabled: false,
        name: 'Project gbrain Backend',
        tagline: 'Project gbrain requires a selected working directory.',
      },
    }
  }

  const mcp = source.config.mcp
  const config = {
    ...source.config,
    name: 'Project gbrain Backend',
    tagline: 'Project-bound graph and vector memory backend for Agent Pi.',
    mcp: {
      ...mcp,
    },
  }

  if (mcp.transport === 'stdio') {
    config.mcp.env = {
      ...mcp.env,
      PATH: withUserBunBinOnPath(mcp.env?.PATH ?? process.env.PATH),
      AGENT_PI_PROJECT_ROOT: context.workingDirectory,
      AGENT_PI_PROJECT_BRAIN_PATH: context.projectBrainPath,
      AGENT_PI_PROJECT_GBRAIN_PATH: context.projectGbrainPath,
      AGENT_PI_GBRAIN_NAMESPACE: context.namespace,
      GBRAIN_NAMESPACE: context.namespace,
      GBRAIN_SOURCE: context.namespace,
      GBRAIN_HOME: context.projectGbrainPath,
      GBRAIN_PROJECT_ROOT: context.workingDirectory,
      ...(context.postgresDatabaseUrl ? {
        GBRAIN_DATABASE_URL: context.postgresDatabaseUrl,
        DATABASE_URL: context.postgresDatabaseUrl,
      } : {}),
    }
  } else {
    config.mcp.headers = {
      ...mcp.headers,
      'X-Agent-Pi-Project-Namespace': context.namespace,
      'X-Agent-Pi-Project-Root-B64': toBase64(context.workingDirectory),
      'X-Agent-Pi-Project-Brain-B64': toBase64(context.projectBrainPath),
      'X-Agent-Pi-Project-Gbrain-B64': toBase64(context.projectGbrainPath),
    }
  }

  return {
    ...source,
    config,
    guide: source.guide
      ? {
          ...source.guide,
          raw: `${source.guide.raw.trimEnd()}\n\n## Project Binding\n\nThis runtime instance is bound to namespace \`${context.namespace}\` for working directory \`${context.workingDirectory}\`. Do not read or write memories for unrelated project folders unless the user explicitly attaches a separate company or industry knowledge source.\n`,
        }
      : source.guide,
  }
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function getConfiguredPostgresDatabaseName(postgresUrl: string | undefined): string | undefined {
  const trimmed = postgresUrl?.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')).trim() || undefined
  } catch {
    return undefined
  }
}

function sanitizePostgresDatabaseName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'agent_pi_gbrain'
}

function withUserBunBinOnPath(currentPath: string | undefined): string {
  if (process.platform !== 'win32') return currentPath ?? ''

  const userProfile = process.env.USERPROFILE
  if (!userProfile) return currentPath ?? ''

  const bunBinPath = join(userProfile, '.bun', 'bin')
  if (!existsSync(bunBinPath)) return currentPath ?? ''

  const existing = (currentPath ?? '').split(delimiter).map(item => item.toLowerCase())
  if (existing.includes(bunBinPath.toLowerCase())) return currentPath ?? ''

  return currentPath ? `${bunBinPath}${delimiter}${currentPath}` : bunBinPath
}
