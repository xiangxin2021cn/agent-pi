/** Soft limit for Electron/Node main-process RSS before rejecting new spawns. */
export const DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES = 1536 * 1024 * 1024 // 1.5 GiB

/**
 * Legacy fallback when physical RAM cannot be read.
 * Live caps prefer `physicalMemoryBytes * DEFAULT_SPAWN_MEMORY_FRACTION`.
 */
export const DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB = 3584 * 1024 // 3.5 GiB

/** Fraction of machine RAM used as the Electron-family spawn cap when env is unset. */
export const DEFAULT_SPAWN_MEMORY_FRACTION = 0.35

/** Never let the RAM-proportional cap fall below this (tiny VMs / misreported totalmem). */
export const DEFAULT_SPAWN_TOTAL_FLOOR_KB = 1536 * 1024 // 1.5 GiB

const MIN_SPAWN_MEMORY_FRACTION = 0.1
const MAX_SPAWN_MEMORY_FRACTION = 0.8

export type SpawnMemoryGuardReason =
  | 'ok'
  | 'main-rss-limit'
  | 'total-working-set-limit'
  | 'total-private-limit'

export interface SpawnMemoryGuardInput {
  mainRssBytes: number
  totalWorkingSetKb?: number
  /** Electron `memory.privateBytes` summed across app processes (already in KB). */
  totalPrivateKb?: number
  physicalMemoryBytes?: number
  platform?: NodeJS.Platform
  mainRssLimitBytes?: number
  /** Absolute total cap in KB. When omitted, derived from RAM × fraction. */
  totalLimitKb?: number
  /** @deprecated Same as totalLimitKb; kept so existing call sites keep compiling. */
  totalWorkingSetLimitKb?: number
  memoryFraction?: number
}

export interface SpawnMemoryGuardDecision {
  blocked: boolean
  reason: SpawnMemoryGuardReason
  message?: string
}

export interface SpawnMemoryGuardEnvLimits {
  mainRssLimitBytes: number
  /** Set only when CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB is a valid override. */
  explicitTotalLimitKb?: number
  memoryFraction: number
}

function formatGiB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

function formatGiBFromKb(kb: number): string {
  return `${(kb / (1024 * 1024)).toFixed(2)} GiB`
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SPAWN_MEMORY_FRACTION
  return Math.min(MAX_SPAWN_MEMORY_FRACTION, Math.max(MIN_SPAWN_MEMORY_FRACTION, value))
}

export function resolveSpawnTotalLimitKb(input: {
  physicalMemoryBytes?: number
  explicitLimitKb?: number
  memoryFraction?: number
  floorKb?: number
  fallbackKb?: number
} = {}): number {
  if (input.explicitLimitKb !== undefined && Number.isFinite(input.explicitLimitKb) && input.explicitLimitKb > 0) {
    return input.explicitLimitKb
  }

  const fraction = clampFraction(input.memoryFraction ?? DEFAULT_SPAWN_MEMORY_FRACTION)
  const floorKb = input.floorKb ?? DEFAULT_SPAWN_TOTAL_FLOOR_KB
  const fallbackKb = input.fallbackKb ?? DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB
  const physical = input.physicalMemoryBytes

  if (physical !== undefined && Number.isFinite(physical) && physical > 0) {
    const fromRamKb = Math.floor((physical * fraction) / 1024)
    return Math.max(fromRamKb, floorKb)
  }

  return fallbackKb
}

function shouldUsePrivateBytes(input: SpawnMemoryGuardInput): boolean {
  const platform = input.platform ?? (typeof process !== 'undefined' ? process.platform : undefined)
  if (platform !== 'win32') return false
  return input.totalPrivateKb !== undefined
    && Number.isFinite(input.totalPrivateKb)
    && input.totalPrivateKb > 0
}

export function decideSpawnMemoryGuard(input: SpawnMemoryGuardInput): SpawnMemoryGuardDecision {
  const mainRssLimit = input.mainRssLimitBytes ?? DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES
  const totalLimitKb = input.totalLimitKb
    ?? input.totalWorkingSetLimitKb
    ?? resolveSpawnTotalLimitKb({
      physicalMemoryBytes: input.physicalMemoryBytes,
      memoryFraction: input.memoryFraction,
    })

  if (Number.isFinite(input.mainRssBytes) && input.mainRssBytes > mainRssLimit) {
    return {
      blocked: true,
      reason: 'main-rss-limit',
      message: `spawn_session blocked: main process memory is ${formatGiB(input.mainRssBytes)} (limit ${formatGiB(mainRssLimit)}). Finish or stop existing sub-agents before spawning more.`,
    }
  }

  if (shouldUsePrivateBytes(input) && input.totalPrivateKb! > totalLimitKb) {
    return {
      blocked: true,
      reason: 'total-private-limit',
      message: `spawn_session blocked: total private memory is ${formatGiBFromKb(input.totalPrivateKb!)} (limit ${formatGiBFromKb(totalLimitKb)}). Finish or stop existing sub-agents before spawning more.`,
    }
  }

  if (
    !shouldUsePrivateBytes(input)
    && input.totalWorkingSetKb !== undefined
    && Number.isFinite(input.totalWorkingSetKb)
    && input.totalWorkingSetKb > totalLimitKb
  ) {
    return {
      blocked: true,
      reason: 'total-working-set-limit',
      message: `spawn_session blocked: total working set is ${formatGiBFromKb(input.totalWorkingSetKb)} (limit ${formatGiBFromKb(totalLimitKb)}). Finish or stop existing sub-agents before spawning more.`,
    }
  }

  return { blocked: false, reason: 'ok' }
}

export function readSpawnMemoryGuardEnvLimits(env: NodeJS.ProcessEnv = process.env): SpawnMemoryGuardEnvLimits {
  const parsePositive = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw.trim() === '') return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    return parsed
  }

  const fractionRaw = parsePositive(env.CRAFT_SPAWN_MEMORY_FRACTION)
  return {
    mainRssLimitBytes: parsePositive(env.CRAFT_SPAWN_MAIN_RSS_LIMIT_BYTES) ?? DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES,
    explicitTotalLimitKb: parsePositive(env.CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB),
    memoryFraction: fractionRaw !== undefined ? clampFraction(fractionRaw) : DEFAULT_SPAWN_MEMORY_FRACTION,
  }
}

/** Capacity / backpressure — keep work queued, do not mark the task failed. */
export function isSpawnCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /active handoff limit reached/i.test(message)
    || /spawn_session blocked/i.test(message)
    || /Finish or stop existing sub-agents/i.test(message)
    || /Return control and let (the runtime monitor existing handoffs|existing children finish)/i.test(message)
    || /blocked by memory (guard|pressure)/i.test(message)
    || /blocked by tender stage concurrency/i.test(message)
}
