import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Regression test for the High-severity finding in eb81086e:
//
//   sendMessage's `{ accepted, messageId }` ack contract was returning before
//   the user message hit disk because `persistSession` only enqueues with a
//   500ms debounce. A crash inside the debounce window after ack would lose
//   the message.
//
// The fix added `await this.flushSession(managed.id)` between persistSession
// and onAck. This test locks that ordering by reading the session file from
// inside the onAck callback and asserting the user message is already there.

describe('sendMessage durability', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-durability-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'durability test' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function readPersistedMessageIds(sessionId: string): string[] {
    const path = getSessionFilePath(tmpRoot, sessionId)
    if (!existsSync(path)) return []
    const lines = readFileSync(path, 'utf-8').trim().split('\n')
    // First line is the header, remaining lines are messages.
    return lines.slice(1).map(l => JSON.parse(l)).map(m => m.id as string)
  }

  it('user message is on disk before onAck fires (normal branch)', async () => {
    const sessionId = 'durability-normal'
    buildSession(sessionId)

    let ackedMessageId: string | null = null
    let onDiskAtAck = false

    // sendMessage continues past the ack into agent-init, which would throw
    // because we haven't called `setSessionPlatform()` in this minimal test
    // harness. That's fine — we only care about the persist+flush+ack ordering
    // that happens before agent-init. Catch the post-ack rejection.
    await sm
      .sendMessage(
        sessionId,
        'hello',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (messageId) => {
          ackedMessageId = messageId
          onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
        },
      )
      .catch(() => { /* expected post-ack agent-init failure */ })

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
  })

  it('user message is on disk before onAck fires (mid-stream / queued branch)', async () => {
    const sessionId = 'durability-midstream'
    const managed = buildSession(sessionId)
    // Force the mid-stream branch. Agent is null, so redirect() falls back to
    // false and the queue path runs.
    managed.isProcessing = true

    let ackedMessageId: string | null = null
    let onDiskAtAck = false

    await sm.sendMessage(
      sessionId,
      'queued message',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (messageId) => {
        ackedMessageId = messageId
        onDiskAtAck = readPersistedMessageIds(sessionId).includes(messageId)
      },
    )

    expect(ackedMessageId).not.toBeNull()
    expect(onDiskAtAck).toBe(true)
  })

  it('queues a tender parent message while backend batch tasks are still running', async () => {
    const sessionId = 'tender-parent-wait'
    const managed = buildSession(sessionId)
    const projectRoot = join(tmpRoot, 'project')
    const taskBoardPath = join(
      projectRoot,
      '.agent-pi',
      'business',
      'tender',
      'n3-tender',
      'orchestration',
      'task-boards',
      'tender-document-analysis.json',
    )
    mkdirSync(join(taskBoardPath, '..'), { recursive: true })
    const taskBoard = {
      schemaVersion: 1,
      projectId: 'n3-tender',
      stageId: 'tender-document-analysis',
      parentSessionId: sessionId,
      maxConcurrency: 4,
      updatedAt: new Date().toISOString(),
      taskBoardPath,
      tasks: [{
        batchId: 'document-1',
        name: 'Document 1',
        status: 'running',
        briefPath: join(projectRoot, 'brief.json'),
        reportPath: join(projectRoot, 'report.json'),
        allowedSourcePaths: [],
        sessionId: 'child-1',
        attemptCount: 1,
        updatedAt: new Date().toISOString(),
      }],
    }
    writeFileSync(taskBoardPath, JSON.stringify(taskBoard))
    managed.workingDirectory = projectRoot
    managed.businessContext = {
      module: 'tender',
      projectId: 'n3-tender',
      workflowId: 'tender-main',
      stageId: 'tender-document-analysis',
    }
    ;(sm as unknown as { scheduleSpawnHandoffMonitor: () => void }).scheduleSpawnHandoffMonitor = () => undefined

    await expect(sm.sendMessage(sessionId, 'Merge the completed batch reports.')).resolves.toBeUndefined()

    expect(managed.isProcessing).toBe(false)
    expect(managed.agent).toBeNull()
    expect(managed.messageQueue).toHaveLength(1)
    expect(managed.messageQueue[0]?.message).toBe('Merge the completed batch reports.')
    expect(managed.spawnHandoffWait?.childSessionIds).toEqual(['child-1'])

    writeFileSync(taskBoardPath, JSON.stringify({
      ...taskBoard,
      tasks: taskBoard.tasks.map((task) => ({ ...task, status: 'complete' })),
    }))
    const resumed: string[] = []
    ;(sm as unknown as { processNextQueuedMessage: (id: string) => void }).processNextQueuedMessage = (id) => {
      resumed.push(id)
    }
    ;(sm as unknown as { checkWaitingParentSpawnHandoffs: (id: string) => void })
      .checkWaitingParentSpawnHandoffs(sessionId)

    expect(resumed).toEqual([sessionId])
    expect(managed.spawnHandoffWait).toBeUndefined()
  })
})
