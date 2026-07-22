import { describe, expect, it } from 'bun:test'
import {
  decideRendererRecovery,
  nextRendererRecoveryState,
  type RendererRecoveryState,
} from '../renderer-recovery'

describe('renderer recovery', () => {
  it('reloads when renderer crashes and the window is still alive', () => {
    const decision = decideRendererRecovery({
      details: { reason: 'crashed', exitCode: -36861 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state: { recentRecoveries: [], nowMs: 1_000 },
    })

    expect(decision).toEqual({
      action: 'reload',
      reason: 'renderer-crashed',
    })
  })

  it('reloads on oom and killed reasons', () => {
    expect(decideRendererRecovery({
      details: { reason: 'oom', exitCode: -1 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state: { recentRecoveries: [], nowMs: 1_000 },
    }).action).toBe('reload')

    expect(decideRendererRecovery({
      details: { reason: 'killed', exitCode: 9 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state: { recentRecoveries: [], nowMs: 1_000 },
    }).action).toBe('reload')
  })

  it('ignores recovery when the window or webContents is already destroyed', () => {
    expect(decideRendererRecovery({
      details: { reason: 'crashed', exitCode: 1 },
      windowDestroyed: true,
      webContentsDestroyed: false,
      state: { recentRecoveries: [], nowMs: 1_000 },
    }).action).toBe('ignore')

    expect(decideRendererRecovery({
      details: { reason: 'crashed', exitCode: 1 },
      windowDestroyed: false,
      webContentsDestroyed: true,
      state: { recentRecoveries: [], nowMs: 1_000 },
    }).action).toBe('ignore')
  })

  it('rate-limits repeated recoveries to avoid crash loops', () => {
    const state: RendererRecoveryState = {
      recentRecoveries: [1_000, 2_000, 3_000],
      nowMs: 3_500,
    }

    const decision = decideRendererRecovery({
      details: { reason: 'crashed', exitCode: 1 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state,
    })

    expect(decision).toEqual({
      action: 'ignore',
      reason: 'recovery-rate-limited',
    })
  })

  it('allows recovery again after the rate-limit window expires', () => {
    const state: RendererRecoveryState = {
      recentRecoveries: [1_000, 2_000, 3_000],
      nowMs: 70_000,
    }

    expect(decideRendererRecovery({
      details: { reason: 'crashed', exitCode: 1 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state,
    }).action).toBe('reload')
  })

  it('tracks recent recoveries when a reload is attempted', () => {
    const next = nextRendererRecoveryState(
      { recentRecoveries: [1_000], nowMs: 5_000 },
      { action: 'reload', reason: 'renderer-crashed' },
    )

    expect(next.recentRecoveries).toEqual([1_000, 5_000])
  })

  it('does not reload clean renderer exits', () => {
    expect(decideRendererRecovery({
      details: { reason: 'clean-exit', exitCode: 0 },
      windowDestroyed: false,
      webContentsDestroyed: false,
      state: { recentRecoveries: [], nowMs: 1_000 },
    })).toEqual({
      action: 'ignore',
      reason: 'clean-exit',
    })
  })
})
