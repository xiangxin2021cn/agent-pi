import { describe, expect, it } from 'bun:test'
import {
  decideSpawnMemoryGuard,
  DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES,
  DEFAULT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB,
  readSpawnMemoryGuardEnvLimits,
} from '../runtime-memory-guard'

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
    })

    expect(limits.mainRssLimitBytes).toBe(2 * 1024 * 1024 * 1024)
    expect(limits.totalWorkingSetLimitKb).toBe(4 * 1024 * 1024)
  })

  it('falls back to defaults for invalid env values', () => {
    const limits = readSpawnMemoryGuardEnvLimits({
      CRAFT_SPAWN_MAIN_RSS_LIMIT_BYTES: 'not-a-number',
      CRAFT_SPAWN_TOTAL_WORKING_SET_LIMIT_KB: '-1',
    })

    expect(limits.mainRssLimitBytes).toBe(DEFAULT_SPAWN_MAIN_RSS_LIMIT_BYTES)
  })
})
