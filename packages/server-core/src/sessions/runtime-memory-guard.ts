/** Soft limit for Electron/Node main-process RSS before rejecting new spawns. */
export const DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES = 1536 * 1024 * 1024 // 1.5 GiB

/** Soft limit for Electron total working set (all process types) before rejecting new spawns. */
export const DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB = 3584 * 1024 // 3.5 GiB

export type SpawnMemoryGuardReason =
  | 'ok'
  | 'main-rss-limit'
  | 'total-working-set-limit'

export interface SpawnMemoryGuardInput {
  mainRssBytes: number
  totalWorkingSetKb?: number
  mainRssLimitBytes?: number
  totalWorkingSetLimitKb?: number
}

export interface SpawnMemoryGuardDecision {
  blocked: boolean
  reason: SpawnMemoryGuardReason
  message?: string
}

function formatGiB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function formatGiBFromKb(kb: number): string {
  return `${(kb / (1024 * 1024)).toFixed(2)} GiB`
}

export function decideSpawnMemoryGuard(input: SpawnMemoryGuardInput): SpawnMemoryGuardDecision {
  const mainRssLimit = input.mainRssLimitBytes ?? DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES
  const totalWsLimit = input.totalWorkingSetLimitKb ?? DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB

  if (Number.isFinite(input.mainRssBytes) && input.mainRssBytes > mainRssLimit) {
    return {
      blocked: true,
      reason: 'main-rss-limit',
      message: `spawn_session blocked: main process memory is ${formatGiB(input.mainRssBytes)} (limit ${formatGiB(mainRssLimit)}). Finish or stop existing sub-agents before spawning more.`,
    }
  }

  if (
    input.totalWorkingSetKb !== undefined
    && Number.isFinite(input.totalWorkingSetKb)
    && input.totalWorkingSetKb > totalWsLimit
  ) {
    return {
      blocked: true,
      reason: 'total-working-set-limit',
      message: `spawn_session blocked: total working set is ${formatGiBFromKb(input.totalWorkingSetKb)} (limit ${formatGiBFromKb(totalWsLimit)}). Finish or stop existing sub-agents before spawning more.`,
    }
  }

  return { blocked: false, reason: 'ok' }
}

export function readSpawnMemoryGuardEnvLimits(env: NodeJS.ProcessEnv = process.env): {
  mainRssLimitBytes: number
  totalWorkingSetLimitKb: number
} {
  const parsePositive = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === '') return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return parsed
  }

  return {
    mainRssLimitBytes: parsePositive(env.CRAFT_SPAWN_MAIN_RSS_LIMIT_BYTES, DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES),
    totalWorkingSetLimitKb: parsePositive(
      env.CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB,
      DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB,
    ),
  }
}
