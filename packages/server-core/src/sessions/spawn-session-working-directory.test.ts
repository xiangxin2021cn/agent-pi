import { describe, expect, it } from 'bun:test'
import { resolveSpawnedSessionWorkingDirectory } from './SessionManager'

describe('spawn_session working directory inheritance', () => {
  it('uses an explicit spawned-session working directory when provided', () => {
    expect(resolveSpawnedSessionWorkingDirectory('C:/child', 'C:/parent')).toBe('C:/child')
  })

  it('inherits the parent session working directory when omitted', () => {
    expect(resolveSpawnedSessionWorkingDirectory(undefined, 'C:/parent-project')).toBe('C:/parent-project')
  })

  it('preserves parent no-working-directory sessions instead of falling back to workspace default', () => {
    expect(resolveSpawnedSessionWorkingDirectory(undefined, undefined)).toBe('none')
  })
})
