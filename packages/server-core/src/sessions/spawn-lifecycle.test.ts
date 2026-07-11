import { describe, expect, it } from 'bun:test'
import { resolveSpawnActivityState } from './spawn-lifecycle'

describe('spawn activity lifecycle', () => {
  it('keeps an active child pending while recent activity advances', () => {
    const state = resolveSpawnActivityState({
      now: 100_000,
      lastActivityAt: 95_000,
      staleAfterMs: 60_000,
      isProcessing: true,
      queueLength: 0,
      reportReady: false,
      failedLifecycle: false,
      hasReportPath: true,
    })

    expect(state.isStale).toBe(false)
    expect(state.handoffStatus).toBe('pending')
    expect(state.lifecycleStatus).toBe('running')
  })

  it('marks a child stale only after its last activity exceeds the activity timeout', () => {
    const state = resolveSpawnActivityState({
      now: 200_001,
      lastActivityAt: 100_000,
      staleAfterMs: 100_000,
      isProcessing: true,
      queueLength: 0,
      reportReady: false,
      failedLifecycle: false,
      hasReportPath: true,
    })

    expect(state.isStale).toBe(true)
    expect(state.handoffStatus).toBe('failed')
    expect(state.lifecycleStatus).toBe('stale')
  })

  it('marks a persisted running child stale when activity stops and no handoff arrives', () => {
    const state = resolveSpawnActivityState({
      now: 200_001,
      lastActivityAt: 100_000,
      staleAfterMs: 100_000,
      isProcessing: false,
      queueLength: 0,
      reportReady: false,
      failedLifecycle: false,
      hasReportPath: true,
      fallbackLifecycleStatus: 'running',
    })

    expect(state.isStale).toBe(true)
    expect(state.handoffStatus).toBe('failed')
    expect(state.lifecycleStatus).toBe('stale')
  })
})
