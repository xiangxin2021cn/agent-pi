import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LoadedSource } from '@craft-agent/shared/sources'
import {
  GBRAIN_SOURCE_SLUG,
  getProjectGbrainContext,
  getProjectGbrainNamespace,
  getProjectGbrainPostgresDatabaseUrl,
  getProjectGbrainSessionSourceSlugs,
  withProjectGbrainSourceContext,
} from './project-gbrain-source'

describe('project gbrain source binding', () => {
  it('derives a stable project namespace from the working directory', () => {
    const workingDirectory = join(tmpdir(), 'Agent Pi Project A')

    expect(getProjectGbrainNamespace(workingDirectory)).toMatch(/^project-[a-f0-9]{16}$/)
    expect(getProjectGbrainNamespace(workingDirectory)).toBe(getProjectGbrainNamespace(workingDirectory))
    expect(getProjectGbrainNamespace(join(tmpdir(), 'Agent Pi Project B'))).not.toBe(getProjectGbrainNamespace(workingDirectory))
  })

  it('adds project gbrain only for project-bound sessions', () => {
    const projectMemory = {
      gbrain: {
        enabled: true,
        backend: 'local_pglite' as const,
      },
    }

    expect(getProjectGbrainSessionSourceSlugs(['docs'], projectMemory, join(tmpdir(), 'project'))).toEqual([
      'docs',
      GBRAIN_SOURCE_SLUG,
    ])
    expect(getProjectGbrainSessionSourceSlugs(['docs', GBRAIN_SOURCE_SLUG], projectMemory, undefined)).toEqual(['docs'])
    expect(getProjectGbrainSessionSourceSlugs(['docs', GBRAIN_SOURCE_SLUG], {
      gbrain: {
        enabled: false,
        backend: 'local_pglite' as const,
      },
    }, join(tmpdir(), 'project'))).toEqual(['docs'])
  })

  it('uses a project-specific local gbrain path under a configured base folder', () => {
    const workingDirectory = join(tmpdir(), 'Agent Pi Project C')
    const context = getProjectGbrainContext(workingDirectory, {
      gbrain: {
        enabled: true,
        backend: 'local_pglite',
        localDatabasePath: join(tmpdir(), 'agent-pi-gbrain-base'),
      },
    })!

    expect(context.projectGbrainPath).toBe(join(tmpdir(), 'agent-pi-gbrain-base', context.namespace))
  })

  it('derives a separate PostgreSQL database URL for each project directory', () => {
    const postgresUrl = 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain'
    const projectA = join(tmpdir(), 'Agent Pi Project Postgres A')
    const projectB = join(tmpdir(), 'Agent Pi Project Postgres B')
    const urlA = getProjectGbrainPostgresDatabaseUrl(projectA, postgresUrl)!
    const urlB = getProjectGbrainPostgresDatabaseUrl(projectB, postgresUrl)!

    expect(urlA).toMatch(/^postgres:\/\/postgres:secret@127\.0\.0\.1:5433\/agent_pi_gbrain_[a-f0-9]{16}$/)
    expect(urlB).toMatch(/^postgres:\/\/postgres:secret@127\.0\.0\.1:5433\/agent_pi_gbrain_[a-f0-9]{16}$/)
    expect(urlA).not.toBe(urlB)
  })

  it('disables gbrain sources when no project context is available', () => {
    const bound = withProjectGbrainSourceContext(
      createGbrainSource({ transport: 'stdio' }),
      undefined,
      {
        gbrain: {
          enabled: true,
          backend: 'local_pglite',
        },
      },
    )

    expect(bound.config.enabled).toBe(false)
    expect(bound.config.tagline).toContain('requires a selected working directory')
  })

  it('injects local stdio environment variables for the project boundary', () => {
    const workingDirectory = join(tmpdir(), 'Agent Pi Project D')
    const bound = withProjectGbrainSourceContext(
      createGbrainSource({ transport: 'stdio' }),
      workingDirectory,
      {
        gbrain: {
          enabled: true,
          backend: 'local_pglite',
        },
      },
    )

    expect(bound.config.name).toBe('Project gbrain Backend')
    expect(bound.config.mcp?.env?.GBRAIN_NAMESPACE).toBe(getProjectGbrainNamespace(workingDirectory))
    expect(bound.config.mcp?.env?.GBRAIN_SOURCE).toBe(getProjectGbrainNamespace(workingDirectory))
    expect(bound.config.mcp?.env?.GBRAIN_HOME).toBe(join(workingDirectory, '.agent-pi', 'gbrain'))
    expect(bound.config.mcp?.env?.AGENT_PI_PROJECT_ROOT).toBe(workingDirectory)
    expect(bound.guide?.raw).toContain('Project Binding')
  })

  it('injects local PostgreSQL URL for project-bound gbrain sessions', () => {
    const workingDirectory = join(tmpdir(), 'Agent Pi Project Postgres')
    const bound = withProjectGbrainSourceContext(
      createGbrainSource({ transport: 'stdio' }),
      workingDirectory,
      {
        gbrain: {
          enabled: true,
          backend: 'local_postgres',
          postgresUrl: 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
        },
      },
    )

    expect(bound.config.mcp?.env?.GBRAIN_SOURCE).toBe(getProjectGbrainNamespace(workingDirectory))
    expect(bound.config.mcp?.env?.GBRAIN_DATABASE_URL).toBe(getProjectGbrainPostgresDatabaseUrl(
      workingDirectory,
      'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
    ))
    expect(bound.config.mcp?.env?.DATABASE_URL).toBe(getProjectGbrainPostgresDatabaseUrl(
      workingDirectory,
      'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
    ))
  })

  it('injects remote MCP project namespace headers without raw path headers', () => {
    const workingDirectory = join(tmpdir(), 'Agent Pi Project E')
    const bound = withProjectGbrainSourceContext(
      createGbrainSource({ transport: 'http' }),
      workingDirectory,
      {
        gbrain: {
          enabled: true,
          backend: 'remote_mcp',
          remoteMcpUrl: 'https://memory.example.com/mcp',
        },
      },
    )

    expect(bound.config.mcp?.headers?.['X-Agent-Pi-Project-Namespace']).toBe(getProjectGbrainNamespace(workingDirectory))
    expect(bound.config.mcp?.headers?.['X-Agent-Pi-Project-Root-B64']).toBe(Buffer.from(workingDirectory, 'utf8').toString('base64'))
    expect(bound.config.mcp?.headers?.['X-Agent-Pi-Project-Root']).toBeUndefined()
  })
})

function createGbrainSource(options: { transport: 'stdio' | 'http' }): LoadedSource {
  return {
    config: {
      id: GBRAIN_SOURCE_SLUG,
      name: 'gbrain',
      slug: GBRAIN_SOURCE_SLUG,
      enabled: true,
      provider: 'gbrain',
      type: 'mcp',
      isAuthenticated: options.transport === 'http',
      mcp: options.transport === 'stdio'
        ? {
            transport: 'stdio',
            command: 'gbrain',
            args: ['serve'],
            authType: 'none',
          }
        : {
            transport: 'http',
            url: 'https://memory.example.com/mcp',
            authType: 'bearer',
          },
    },
    guide: {
      raw: '# gbrain\n',
    },
    folderPath: join(tmpdir(), 'source'),
    workspaceRootPath: join(tmpdir(), 'workspace'),
    workspaceId: 'workspace',
  }
}
