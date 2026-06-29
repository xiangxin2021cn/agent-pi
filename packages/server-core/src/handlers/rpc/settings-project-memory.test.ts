import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  GBRAIN_SOURCE_SLUG,
  buildGbrainSourceConfig,
  getGbrainDefaultSourceSlugs,
  normalizeProjectMemorySetting,
  syncGbrainSourceConfig,
} from './settings'

describe('normalizeProjectMemorySetting', () => {
  it('normalizes disabled gbrain settings with a local default backend', () => {
    expect(normalizeProjectMemorySetting({
      gbrain: {
        enabled: false,
      },
    })).toEqual({
      gbrain: {
        enabled: false,
        backend: 'local_pglite',
      },
    })
  })

  it('accepts a remote MCP URL when present', () => {
    expect(normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
        remoteMcpUrl: ' https://memory.example.com/mcp ',
      },
    })).toEqual({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
        remoteMcpUrl: 'https://memory.example.com/mcp',
      },
    })
  })

  it('rejects unsupported gbrain backends', () => {
    expect(() => normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'vector_everything',
      },
    })).toThrow('projectMemory.gbrain.backend')
  })

  it('accepts a local PostgreSQL URL when present', () => {
    expect(normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'local_postgres',
        postgresUrl: ' postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain ',
      },
    })).toEqual({
      gbrain: {
        enabled: true,
        backend: 'local_postgres',
        postgresUrl: 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
      },
    })
  })

  it('requires a PostgreSQL URL when local PostgreSQL gbrain is enabled', () => {
    expect(() => normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'local_postgres',
      },
    })).toThrow('postgresUrl is required')
  })

  it('rejects non-http remote MCP URLs', () => {
    expect(() => normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
        remoteMcpUrl: 'file:///tmp/mcp',
      },
    })).toThrow('projectMemory.gbrain.remoteMcpUrl')
  })

  it('requires a remote MCP URL when remote gbrain is enabled', () => {
    expect(() => normalizeProjectMemorySetting({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
      },
    })).toThrow('remoteMcpUrl is required')
  })
})

describe('gbrain source config', () => {
  it('builds a local stdio MCP source for enabled PGLite mode', () => {
    expect(buildGbrainSourceConfig({
      gbrain: {
        enabled: true,
        backend: 'local_pglite',
        localDatabasePath: 'C:\\brain\\brain.pglite',
      },
    }, null, 100)).toMatchObject({
      slug: GBRAIN_SOURCE_SLUG,
      enabled: true,
      provider: 'gbrain',
      type: 'mcp',
      name: 'Project gbrain Backend',
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
      createdAt: 100,
    })
  })

  it('builds a local stdio MCP source for enabled PostgreSQL mode', () => {
    expect(buildGbrainSourceConfig({
      gbrain: {
        enabled: true,
        backend: 'local_postgres',
        postgresUrl: 'postgres://postgres:secret@127.0.0.1:5433/agent_pi_gbrain',
      },
    }, null, 100)).toMatchObject({
      slug: GBRAIN_SOURCE_SLUG,
      enabled: true,
      provider: 'gbrain',
      type: 'mcp',
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
      createdAt: 100,
    })
  })

  it('builds a remote HTTP MCP source and preserves auth when the URL is unchanged', () => {
    const previous = buildGbrainSourceConfig({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
        remoteMcpUrl: 'https://memory.example.com/mcp',
      },
    }, null, 100)!
    previous.isAuthenticated = true

    expect(buildGbrainSourceConfig({
      gbrain: {
        enabled: true,
        backend: 'remote_mcp',
        remoteMcpUrl: 'https://memory.example.com/mcp',
      },
    }, previous, 200)).toMatchObject({
      slug: GBRAIN_SOURCE_SLUG,
      enabled: true,
      isAuthenticated: true,
      mcp: {
        transport: 'http',
        url: 'https://memory.example.com/mcp',
        authType: 'bearer',
      },
      createdAt: 100,
    })
  })

  it('keeps project gbrain out of workspace defaults', () => {
    expect(getGbrainDefaultSourceSlugs(['docs'], {
      gbrain: {
        enabled: true,
        backend: 'local_pglite',
      },
    })).toEqual(['docs'])

    expect(getGbrainDefaultSourceSlugs(['docs', GBRAIN_SOURCE_SLUG], {
      gbrain: {
        enabled: true,
        backend: 'local_pglite',
      },
    })).toEqual(['docs'])
  })

  it('writes the gbrain source config and guide into a workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'agent-pi-gbrain-source-'))
    try {
      await syncGbrainSourceConfig(workspaceRoot, {
        gbrain: {
          enabled: true,
          backend: 'remote_mcp',
          remoteMcpUrl: 'https://memory.example.com/mcp',
        },
      })

      const sourceDir = join(workspaceRoot, 'sources', GBRAIN_SOURCE_SLUG)
      const config = JSON.parse(await readFile(join(sourceDir, 'config.json'), 'utf8'))
      const guide = await readFile(join(sourceDir, 'guide.md'), 'utf8')

      expect(config).toMatchObject({
        slug: GBRAIN_SOURCE_SLUG,
        enabled: true,
        provider: 'gbrain',
        type: 'mcp',
        mcp: {
          transport: 'http',
          url: 'https://memory.example.com/mcp',
          authType: 'bearer',
        },
      })
      expect(guide).toContain('Project gbrain Backend')
      expect(guide).toContain('per-working-directory namespace')
      expect(guide).toContain('bearer token')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
