import { describe, expect, it } from 'bun:test'
import { humanizeRuntimeError } from '../turn-utils'

describe('humanizeRuntimeError', () => {
  it('rewrites spawn handoff limit errors with actionable copy', () => {
    const result = humanizeRuntimeError(
      'spawn_session active handoff limit reached (5/4). Return control and let the runtime monitor existing handoffs before spawning more.',
    )
    expect(result).toContain('Sub-agent spawn limit reached (5/4 active)')
    expect(result).toContain('not a model failure')
  })

  it('rewrites memory-guard spawn blocks', () => {
    const result = humanizeRuntimeError(
      'spawn_session blocked by memory guard (main_rss). Finish or stop existing sub-agents before spawning more.',
    )
    expect(result).toContain('memory pressure')
  })

  it('rewrites nested spawn blocks', () => {
    const result = humanizeRuntimeError(
      'Nested spawn_session is disabled for spawned sub-agents. Return a structured handoff with gaps and recommendations to the parent session instead.',
    )
    expect(result).toContain('Nested spawn_session is disabled')
  })

  it('leaves unrelated errors unchanged', () => {
    expect(humanizeRuntimeError('ENOENT: no such file')).toBe('ENOENT: no such file')
  })
})
