import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  getSessionFilePath,
  writeSessionJsonl,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import type { StoredMessage } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('inactive session message release', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-inactive-msgs-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildWorkspace() {
    return {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    } as never
  }

  function seedColdSession(sessionId: string, messages: StoredMessage[]) {
    const filePath = getSessionFilePath(tmpRoot, sessionId)
    mkdirSync(dirname(filePath), { recursive: true })
    const stored: StoredSession = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: sessionId,
      sessionStatus: 'todo',
      labels: [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages,
    } as unknown as StoredSession
    writeSessionJsonl(filePath, stored)

    const managed = createManagedSession(
      { id: sessionId, name: stored.name, sessionStatus: stored.sessionStatus, createdAt: stored.createdAt },
      buildWorkspace(),
    )
    internals().sessions.set(sessionId, managed)
  }

  function makeUserMessage(id: string, content: string): StoredMessage {
    return { id, type: 'user', content, timestamp: Date.now() } as StoredMessage
  }

  function internals() {
    return sm as unknown as {
      sessions: Map<string, {
        id: string
        messages: unknown[]
        messagesLoaded: boolean
        isProcessing: boolean
        agent: unknown
        spawnHandoffWait?: unknown
      }>
      releaseInactiveSessionMessages: () => Promise<void>
    }
  }

  it('does not drop transcripts merely because the user switched the visible chat', async () => {
    const large = 'x'.repeat(80_000)
    seedColdSession('parent', [makeUserMessage('p1', large), makeUserMessage('p2', large)])
    seedColdSession('child', [makeUserMessage('c1', large), makeUserMessage('c2', large)])

    await sm.getSession('parent')
    await sm.getSession('child')
    sm.setActiveViewingSession('parent', 'ws_test')

    expect(internals().sessions.get('parent')?.messagesLoaded).toBe(true)
    expect(internals().sessions.get('child')?.messagesLoaded).toBe(true)
    expect(internals().sessions.get('child')?.messages).toHaveLength(2)
  })

  it('drops idle transcripts after the live runtime is gone, without rewriting JSONL', async () => {
    const large = 'x'.repeat(80_000)
    seedColdSession('child', [makeUserMessage('c1', large), makeUserMessage('c2', large)])
    await sm.getSession('child')
    sm.setActiveViewingSession('parent', 'ws_test')

    await internals().releaseInactiveSessionMessages()
    expect(internals().sessions.get('child')?.messagesLoaded).toBe(false)
    expect(internals().sessions.get('child')?.messages).toHaveLength(0)

    const reloaded = await sm.getSession('child')
    expect(reloaded?.messages.map((message) => message.id)).toEqual(['c1', 'c2'])
    expect(reloaded?.messages.map((message) => message.content)).toEqual([large, large])
  })

  it('keeps transcripts for processing sessions and live agent runtimes', async () => {
    seedColdSession('busy', [makeUserMessage('b1', 'running')])
    seedColdSession('live', [makeUserMessage('l1', 'idle-agent')])
    await sm.getSession('busy')
    await sm.getSession('live')

    internals().sessions.get('busy')!.isProcessing = true
    internals().sessions.get('live')!.agent = { disposeForRestart: async () => undefined }

    sm.setActiveViewingSession(null, 'ws_test')
    await internals().releaseInactiveSessionMessages()

    expect(internals().sessions.get('busy')?.messagesLoaded).toBe(true)
    expect(internals().sessions.get('busy')?.messages).toHaveLength(1)
    expect(internals().sessions.get('live')?.messagesLoaded).toBe(true)
    expect(internals().sessions.get('live')?.messages).toHaveLength(1)
  })
})
