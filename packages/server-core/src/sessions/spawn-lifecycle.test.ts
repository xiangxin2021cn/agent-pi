import { describe, expect, it } from 'bun:test'
import {
  isSpawnReportReady,
  resolveParentSpawnHandoffBarrier,
  resolveSpawnActivityState,
} from './spawn-lifecycle'

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
      isProcessing: false,
      queueLength: 0,
      reportReady: false,
      failedLifecycle: false,
      hasReportPath: true,
      fallbackLifecycleStatus: 'started',
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

  it('never marks a child stale while its backend is still processing', () => {
    const state = resolveSpawnActivityState({
      now: 1_000_000,
      lastActivityAt: 1,
      staleAfterMs: 60_000,
      isProcessing: true,
      queueLength: 0,
      reportReady: false,
      failedLifecycle: false,
      hasReportPath: true,
      fallbackLifecycleStatus: 'running',
    })

    expect(state.isStale).toBe(false)
    expect(state.handoffStatus).toBe('pending')
  })

  it('does not accept a non-empty partial report while the child is still processing', () => {
    expect(isSpawnReportReady({
      reportExists: true,
      reportSize: 2048,
      isProcessing: true,
      queueLength: 0,
    })).toBe(false)
    expect(isSpawnReportReady({
      reportExists: true,
      reportSize: 2048,
      isProcessing: false,
      queueLength: 0,
    })).toBe(true)
  })

  it('keeps the parent waiting until every structured handoff is ready', () => {
    expect(resolveParentSpawnHandoffBarrier({
      requireStructuredHandoff: true,
      statuses: [
        { sessionId: 'child-1', handoffStatus: 'ready' },
        { sessionId: 'child-2', handoffStatus: 'pending' },
      ],
    })).toEqual({
      action: 'wait',
      pendingSessionIds: ['child-2'],
      reviewSessionIds: [],
    })

    expect(resolveParentSpawnHandoffBarrier({
      requireStructuredHandoff: true,
      statuses: [
        { sessionId: 'child-1', handoffStatus: 'ready' },
        { sessionId: 'child-2', handoffStatus: 'ready' },
      ],
    }).action).toBe('resume')
  })

  it('requires user review instead of allowing parent takeover after child failure', () => {
    expect(resolveParentSpawnHandoffBarrier({
      requireStructuredHandoff: true,
      statuses: [
        { sessionId: 'child-1', handoffStatus: 'failed' },
      ],
    })).toEqual({
      action: 'review',
      pendingSessionIds: [],
      reviewSessionIds: ['child-1'],
    })
  })

  it('keeps waiting for active children before reviewing failed children', () => {
    expect(resolveParentSpawnHandoffBarrier({
      requireStructuredHandoff: true,
      statuses: [
        { sessionId: 'child-1', handoffStatus: 'failed' },
        { sessionId: 'child-2', handoffStatus: 'pending' },
      ],
    })).toEqual({
      action: 'wait',
      pendingSessionIds: ['child-2'],
      reviewSessionIds: ['child-1'],
    })
  })
})
