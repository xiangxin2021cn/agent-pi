import { describe, expect, it } from 'bun:test'
import {
  decideSpawnMemoryGuard,
  DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES,
  DEFAULT_SPAWN_MEMORY_FRACTION,
  DEFAULT_SPAWN_TOTAL_FLOOR_KB,
  DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB,
  isSpawnCapacityError,
  readSpawnMemoryGuardEnvLimits,
  resolveSpawnTotalLimitKb,
} from '../runtime-memory-guard'

const GIB = 1024 * 1024 * 1024

describe('runtime memory guard', () => {
  it('allows spawn when memory is below soft limits', () => {
    const decision = decideSpawnMemoryGuard({
      mainRssBytes: 400 * 1024 * 1024,
      totalWorkingSetKb: 900 * 1024,
    })

    expect(decision).toEqual({
      blocked: false,
      reason: 'ok',
    })
  })

  it('blocks spawn when main-process RSS exceeds the soft limit', () => {
    const decision = decideSpawnMemoryGuard({
      mainRssBytes: DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES + 1,
      totalWorkingSetKb: 900 * 1024,
    })

    expect(decision.blocked).toBe(true)
    expect(decision.reason).toBe('main-rss-limit')
    expect(decision.message).toContain('main process memory')
    expect(decision.message).toMatch(/Finish or stop existing sub-agents/i)
  })

  it('blocks spawn when total working set exceeds the soft limit', () => {
    const decision = decideSpawnMemoryGuard({
      mainRssBytes: 400 * 1024 * 1024,
      totalWorkingSetKb: DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB + 1,
    })

    expect(decision.blocked).toBe(true)
    expect(decision.reason).toBe('total-working-set-limit')
    expect(decision.message).toContain('total working set')
  })

  it('ignores missing total working set metrics', () => {
    const decision = decideSpawnMemoryGuard({
      mainRssBytes: 400 * 1024 * 1024,
    })

    expect(decision.blocked).toBe(false)
  })

  it('reads override limits from env', () => {
    const limits = readSpawnMemoryGuardEnvLimits({
      CRAFT_SPAWN_MAIN_RSS_LIMIT_BYTES: String(2 * 1024 * 1024 * 1024),
      CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB: String(4 * 1024 * 1024),
      CRAFT_SPAWN_MEMORY_FRACTION: '0.5',
    })

    expect(limits.mainRssLimitBytes).toBe(2 * 1024 * 1024 * 1024)
    expect(limits.explicitTotalLimitKb).toBe(4 * 1024 * 1024)
    expect(limits.memoryFraction).toBe(0.5)
  })

  it('falls back to defaults for invalid env values', () => {
    const limits = readSpawnMemoryGuardEnvLimits({
      CRAFT_SPAWN_MAIN_RSS_LIMIT_BYTES: 'not-a-number',
      CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB: '-1',
      CRAFT_SPAWN_MEMORY_FRACTION: 'nope',
    })

    expect(limits.mainRssLimitBytes).toBe(DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES)
    expect(limits.explicitTotalLimitKb).toBeUndefined()
    expect(limits.memoryFraction).toBe(DEFAULT_SPAWN_MEMORY_FRACTION)
  })

  it('derives the total cap from physical RAM and keeps a floor', () => {
    expect(resolveSpawnTotalLimitKb({
      physicalMemoryBytes: 32 * GIB,
      memoryFraction: 0.35,
    })).toBe(Math.floor((32 * GIB * 0.35) / 1024))

    expect(resolveSpawnTotalLimitKb({
      physicalMemoryBytes: 2 * GIB,
      memoryFraction: 0.35,
    })).toBe(DEFAULT_SPAWN_TOTAL_FLOOR_KB)

    expect(resolveSpawnTotalLimitKb({
      physicalMemoryBytes: 32 * GIB,
      explicitLimitKb: 8 * 1024 * 1024,
    })).toBe(8 * 1024 * 1024)
  })

  it('on Windows compares private bytes, not summed working set', () => {
    const overcountedWorkingSetKb = DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB + 1
    const privateKb = 1800 * 1024

    const decision = decideSpawnMemoryGuard({
      mainRssBytes: 400 * 1024 * 1024,
      totalWorkingSetKb: overcountedWorkingSetKb,
      totalPrivateKb: privateKb,
      physicalMemoryBytes: 32 * GIB,
      platform: 'win32',
    })

    expect(decision.blocked).toBe(false)
    expect(decision.reason).toBe('ok')
  })

  it('on Windows blocks when private bytes exceed the RAM-proportional cap', () => {
    const decision = decideSpawnMemoryGuard({
      mainRssBytes: 400 * 1024 * 1024,
      totalWorkingSetKb: 900 * 1024,
      totalPrivateKb: 12 * 1024 * 1024,
      physicalMemoryBytes: 32 * GIB,
      platform: 'win32',
    })

    expect(decision.blocked).toBe(true)
    expect(decision.reason).toBe('total-private-limit')
    expect(decision.message).toContain('total private memory')
    expect(isSpawnCapacityError(new Error(decision.message))).toBe(true)
  })
})

describe('isSpawnCapacityError', () => {
  it('matches live memory-guard and handoff-limit messages', () => {
    expect(isSpawnCapacityError(new Error(
      'spawn_session blocked: total working set is 3.60 GiB (limit 3.50 GiB). Finish or stop existing sub-agents before spawning more.',
    ))).toBe(true)
    expect(isSpawnCapacityError(new Error(
      'spawn_session blocked: total private memory is 12.10 GiB (limit 11.20 GiB). Finish or stop existing sub-agents before spawning more.',
    ))).toBe(true)
    expect(isSpawnCapacityError(new Error(
      'spawn_session blocked: main process memory is 1.60 GiB (limit 1.50 GiB). Finish or stop existing sub-agents before spawning more.',
    ))).toBe(true)
    expect(isSpawnCapacityError(new Error(
      'spawn_session blocked by memory guard (total-working-set-limit)',
    ))).toBe(true)
    expect(isSpawnCapacityError(new Error(
      'spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.',
    ))).toBe(true)
    expect(isSpawnCapacityError(new Error('ENOENT: no such file'))).toBe(false)
  })
})
