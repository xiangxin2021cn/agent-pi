import { describe, expect, it } from 'bun:test'
import { getWorkingDirectoryLockDecision, hasProjectBoundActivity } from './working-directory-lock'

describe('hasProjectBoundActivity', () => {
  it('treats loaded messages as project-bound activity', () => {
    expect(hasProjectBoundActivity({ messages: [{}] })).toBe(true)
  })

  it('treats cold metadata message count as project-bound activity', () => {
    expect(hasProjectBoundActivity({ messages: [], messageCount: 2 })).toBe(true)
  })

  it('treats an SDK session as project-bound activity', () => {
    expect(hasProjectBoundActivity({ messages: [], sdkSessionId: 'sdk-1' })).toBe(true)
  })

  it('allows a fresh session to choose its first working directory', () => {
    expect(hasProjectBoundActivity({ messages: [], messageCount: 0 })).toBe(false)
  })
})

describe('getWorkingDirectoryLockDecision', () => {
  it('allows changing the working directory before the session starts', () => {
    const decision = getWorkingDirectoryLockDecision(
      'C:\\projects\\alpha',
      'C:\\projects\\beta',
      { messages: [], messageCount: 0 },
    )

    expect(decision.locked).toBe(false)
  })

  it('allows selecting the same directory after the session starts', () => {
    const decision = getWorkingDirectoryLockDecision(
      'C:\\projects\\alpha',
      'C:\\projects\\alpha',
      { messageCount: 8 },
    )

    expect(decision.locked).toBe(false)
  })

  it('blocks switching project folders after the session starts', () => {
    const decision = getWorkingDirectoryLockDecision(
      'C:\\projects\\alpha',
      'C:\\projects\\beta',
      { messageCount: 8 },
    )

    expect(decision.locked).toBe(true)
    expect(decision.reason).toContain('already bound')
  })

  it('blocks attaching an old history-only session to a new project folder', () => {
    const decision = getWorkingDirectoryLockDecision(
      undefined,
      'C:\\projects\\beta',
      { messageCount: 8 },
    )

    expect(decision.locked).toBe(true)
    expect(decision.reason).toContain('conversation history')
  })
})
