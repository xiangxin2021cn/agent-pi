import { describe, it, expect } from 'bun:test'
import { getPermissionReconcileSessionIds, getSessionsToRefreshAfterStaleReconnect } from '../reconnect-recovery'
import type { SessionMeta } from '@/atoms/sessions'

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 'session',
    workspaceId: overrides.workspaceId ?? 'workspace',
    isProcessing: overrides.isProcessing ?? false,
    ...overrides,
  }
}

describe('getSessionsToRefreshAfterStaleReconnect', () => {
  it('includes the active session and all processing sessions', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active' })],
      ['processing', meta({ id: 'processing', isProcessing: true })],
      ['other', meta({ id: 'other' })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active')).toEqual([
      'active',
      'processing',
    ])
  })

  it('deduplicates the active session when it is already processing', () => {
    const metaMap = new Map<string, SessionMeta>([
      ['active', meta({ id: 'active', isProcessing: true })],
    ])

    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 'active')).toEqual(['active'])
  })
})

describe('getPermissionReconcileSessionIds', () => {
  it('only includes the selected session and processing sessions', () => {
    const sessions = [
      { id: 'selected', isProcessing: false },
      { id: 'busy', isProcessing: true },
      { id: 'allow-all-idle', isProcessing: false },
    ]
    expect(getPermissionReconcileSessionIds(sessions, 'selected')).toEqual(['selected', 'busy'])
  })

  it('does not fan out across idle sessions', () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      isProcessing: false,
    }))
    expect(getPermissionReconcileSessionIds(sessions, 's0')).toEqual(['s0'])
  })

  it('caps processing-session fan-out', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      isProcessing: true,
    }))
    expect(getPermissionReconcileSessionIds(sessions, 's0')).toHaveLength(8)
    expect(getPermissionReconcileSessionIds(sessions, 's0')[0]).toBe('s0')
  })
})

describe('getSessionsToRefreshAfterStaleReconnect cap', () => {
  it('caps processing-session fan-out', () => {
    const metaMap = new Map<string, SessionMeta>(
      Array.from({ length: 20 }, (_, i) => [`s${i}`, meta({ id: `s${i}`, isProcessing: true })]),
    )
    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 's0')).toHaveLength(8)
    expect(getSessionsToRefreshAfterStaleReconnect(metaMap, 's0')[0]).toBe('s0')
  })
})
