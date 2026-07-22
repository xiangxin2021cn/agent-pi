export type RendererGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'
  | string

export interface RendererGoneDetails {
  reason: RendererGoneReason
  exitCode?: number
}

export interface RendererRecoveryState {
  recentRecoveries: number[]
  nowMs: number
}

export interface RendererRecoveryDecision {
  action: 'reload' | 'ignore'
  reason: string
}

/** Max automatic reloads inside the rolling window. */
export const RENDERER_RECOVERY_MAX_ATTEMPTS = 3
/** Rolling window for rate-limiting crash loops. */
export const RENDERER_RECOVERY_WINDOW_MS = 60_000

const RECOVERABLE_REASONS = new Set([
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
])

function pruneRecentRecoveries(recentRecoveries: number[], nowMs: number): number[] {
  return recentRecoveries.filter((at) => nowMs - at <= RENDERER_RECOVERY_WINDOW_MS)
}

export function decideRendererRecovery(input: {
  details: RendererGoneDetails
  windowDestroyed: boolean
  webContentsDestroyed: boolean
  state: RendererRecoveryState
}): RendererRecoveryDecision {
  if (input.windowDestroyed || input.webContentsDestroyed) {
    return { action: 'ignore', reason: 'window-destroyed' }
  }

  const recent = pruneRecentRecoveries(input.state.recentRecoveries, input.state.nowMs)
  if (recent.length >= RENDERER_RECOVERY_MAX_ATTEMPTS) {
    return { action: 'ignore', reason: 'recovery-rate-limited' }
  }

  if (!RECOVERABLE_REASONS.has(input.details.reason) && input.details.reason !== 'clean-exit') {
    // Unknown reasons still recover once — better than blank/dead UI on Windows.
    return { action: 'reload', reason: `renderer-${input.details.reason || 'unknown'}` }
  }

  if (input.details.reason === 'clean-exit') {
    return { action: 'ignore', reason: 'clean-exit' }
  }

  return {
    action: 'reload',
    reason: input.details.reason === 'crashed'
      ? 'renderer-crashed'
      : `renderer-${input.details.reason}`,
  }
}

export function nextRendererRecoveryState(
  state: RendererRecoveryState,
  decision: RendererRecoveryDecision,
): RendererRecoveryState {
  const recent = pruneRecentRecoveries(state.recentRecoveries, state.nowMs)
  if (decision.action !== 'reload') {
    return { recentRecoveries: recent, nowMs: state.nowMs }
  }
  return {
    recentRecoveries: [...recent, state.nowMs],
    nowMs: state.nowMs,
  }
}
