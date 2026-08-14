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
    expect(humanizeRuntimeError(
      'spawn_session blocked: total working set is 3.60 GiB (limit 3.50 GiB). Finish or stop existing sub-agents before spawning more.',
    )).toContain('memory pressure')
    expect(humanizeRuntimeError(
      'spawn_session blocked: total private memory is 12.10 GiB (limit 11.20 GiB). Finish or stop existing sub-agents before spawning more.',
    )).toContain('memory pressure')
  })

  it('rewrites nested spawn blocks', () => {
    const result = humanizeRuntimeError(
      'Nested spawn_session is disabled for spawned sub-agents. Return a structured handoff with gaps and recommendations to the parent session instead.',
    )
    expect(result).toContain('Nested spawn_session is disabled')
  })

  it('rewrites tender stage concurrency blocks', () => {
    const result = humanizeRuntimeError(
      'spawn_session active handoff limit reached (2/2) for tender stage "tender-document-analysis". Return control.',
    )
    expect(result).toContain('Tender stage concurrency full')
  })

  it('leaves unrelated errors unchanged', () => {
    expect(humanizeRuntimeError('ENOENT: no such file')).toBe('ENOENT: no such file')
  })
})
