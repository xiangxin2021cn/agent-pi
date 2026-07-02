import { describe, expect, test } from 'bun:test'
import type { FolderSourceConfig, LoadedSource } from '@craft-agent/shared/sources'
import { getMcpToolsSourceReadinessError } from './sources'

function makeSource(config: Partial<FolderSourceConfig> = {}): LoadedSource {
  return {
    config: {
      id: 'source_1',
      name: 'AnySearch MCP',
      slug: 'anysearch-mcp',
      provider: 'anysearch',
      type: 'mcp',
      enabled: false,
      mcp: {
        transport: 'http',
        url: 'https://api.anysearch.com/mcp',
        authType: 'bearer',
      },
      ...config,
    },
    guide: null,
    folderPath: '/tmp/source',
    workspaceRootPath: '/tmp/workspace',
    workspaceId: 'workspace_1',
  }
}

describe('getMcpToolsSourceReadinessError', () => {
  test('rejects disabled sources even after credentials are saved', () => {
    const source = makeSource({
      enabled: false,
      isAuthenticated: true,
      connectionStatus: 'connected',
    })

    expect(getMcpToolsSourceReadinessError(source)).toBe('Source is disabled')
  })

  test('requires authentication for enabled bearer sources', () => {
    const source = makeSource({
      enabled: true,
      isAuthenticated: false,
      connectionStatus: 'needs_auth',
    })

    expect(getMcpToolsSourceReadinessError(source)).toBe('Source requires authentication')
  })

  test('allows enabled authenticated sources', () => {
    const source = makeSource({
      enabled: true,
      isAuthenticated: true,
      connectionStatus: 'connected',
    })

    expect(getMcpToolsSourceReadinessError(source)).toBeNull()
  })
})
