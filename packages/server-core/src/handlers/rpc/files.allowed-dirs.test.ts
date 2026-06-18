import { describe, expect, it } from 'bun:test'
import { join, sep } from 'path'
import { validateFilePath } from '../utils'
import { getSessionArtifactAllowedDirs } from './files'

describe('getSessionArtifactAllowedDirs', () => {
  it('allows a session formal output without opening unrelated external paths', async () => {
    const sessionId = '260617-young-galaxy'
    const systemRoot = sep === '\\' ? 'C:\\Windows' : '/var'
    const workingDirectory = join(systemRoot, sep === '\\' ? 'Temp' : 'tmp', 'agent-pi-working')
    const sessionPath = join(systemRoot, sep === '\\' ? 'Temp' : 'tmp', 'agent-pi-sessions', sessionId)
    const unrelatedPath = join(systemRoot, 'agent-pi-unrelated-preview-test.md')
    const formalOutputPath = join(workingDirectory, 'Agent Pi Outputs', sessionId, 'report.md')

    const sessionManager = {
      getSessions: (workspaceId?: string) => workspaceId === 'workspace-a'
        ? [{
            id: sessionId,
            workspaceId: 'workspace-a',
            workingDirectory,
          }]
        : [],
      getSessionPath: (id: string) => id === sessionId ? sessionPath : null,
    } as Parameters<typeof getSessionArtifactAllowedDirs>[0]

    const allowedDirs = getSessionArtifactAllowedDirs(sessionManager, 'workspace-a')

    expect(allowedDirs).toContain(sessionPath)
    expect(allowedDirs).toContain(workingDirectory)
    expect(allowedDirs).toContain(join(workingDirectory, 'Agent Pi Outputs', sessionId))
    await expect(validateFilePath(formalOutputPath, allowedDirs)).resolves.toBe(formalOutputPath)
    await expect(validateFilePath(unrelatedPath, allowedDirs)).rejects.toThrow('Access denied')
  })
})
