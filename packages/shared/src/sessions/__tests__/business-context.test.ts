import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, listSessions, loadSession } from '../storage.ts'
import { SESSION_PERSISTENT_FIELDS } from '../types.ts'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('session persistence: business project context', () => {
  test('persists business context in full sessions and list metadata', async () => {
    const workspaceRootPath = mkdtempSync(join(tmpdir(), 'business-session-'))
    tempRoots.push(workspaceRootPath)
    const businessContext = {
      module: 'tender' as const,
      projectId: 'n3-tender',
      workflowId: 'tender-main',
      stageId: 'tender-analysis',
    }

    const created = await createSession(workspaceRootPath, {
      name: 'N3 tender analysis',
      workingDirectory: join(workspaceRootPath, 'project'),
      businessContext,
    })

    expect(SESSION_PERSISTENT_FIELDS).toContain('businessContext')
    expect(created.businessContext).toEqual(businessContext)
    expect(loadSession(workspaceRootPath, created.id)?.businessContext).toEqual(businessContext)
    expect(listSessions(workspaceRootPath)[0]?.businessContext).toEqual(businessContext)
  })
})
