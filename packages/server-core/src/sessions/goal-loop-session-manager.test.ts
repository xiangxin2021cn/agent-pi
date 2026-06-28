import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

function message(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
  }
}

function goal(overrides: Partial<SessionGoalState> = {}): SessionGoalState {
  return {
    id: 'goal-1',
    objective: 'Create a complete deliverable',
    mode: 'auto_improve',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [{
      id: 'crit-1',
      text: 'The final report cites the source spreadsheet.',
      kind: 'evidence',
      required: true,
    }],
    auditHistory: [],
    ...overrides,
  }
}

describe('SessionManager goal loop routing', () => {
  let tmpRoot: string
  let sm: SessionManager
  let sessionIds: string[]

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-goal-loop-'))
    sm = new SessionManager()
    sessionIds = []
  })

  afterEach(async () => {
    await Promise.all(sessionIds.map(id => sm.flushSession(id).catch(() => undefined)))
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string, options: { goalState?: SessionGoalState } = { goalState: goal() }) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'goal loop test', goalState: options.goalState },
      workspace as never,
      { messagesLoaded: true },
    )
    if (options.goalState) {
      managed.messages.push(
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      )
    }
    sessionIds.push(id)
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  function captureEvents() {
    const events: SessionEvent[] = []
    sm.setEventSink((_channel, _target, event) => {
      events.push(event as SessionEvent)
    })
    return events
  }

  it('schedules an internal continuation instead of completing when auto_improve can continue', async () => {
    const sessionId = 'goal-continue'
    const managed = buildSession(sessionId)
    const events = captureEvents()
    const continuations: Array<{ sessionId: string; prompt: string; iteration: number }> = []

    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string, prompt: string, iteration: number) => void
    }).scheduleGoalContinuation = (id, prompt, iteration) => {
      continuations.push({ sessionId: id, prompt, iteration })
    }

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(continuations).toHaveLength(1)
    expect(continuations[0].sessionId).toBe(sessionId)
    expect(continuations[0].prompt).toContain('The final report cites the source spreadsheet.')
    expect(continuations[0].iteration).toBe(1)
    expect(managed.goalState?.status).toBe('improving')
    expect(events.some(event => event.type === 'goal_audit_result')).toBe(true)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(false)
    expect(events.some(event => event.type === 'complete')).toBe(false)
  })

  it('processes queued user messages before considering a goal continuation', async () => {
    const sessionId = 'goal-user-preempts'
    const managed = buildSession(sessionId)
    captureEvents()
    const continuations: string[] = []
    const queued: string[] = []

    managed.messageQueue.push({ message: 'user follow-up' } as never)

    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string, prompt: string, iteration: number) => void
      processNextQueuedMessage: (sessionId: string) => void
    }).scheduleGoalContinuation = (id) => {
      continuations.push(id)
    }
    ;(sm as unknown as {
      processNextQueuedMessage: (sessionId: string) => void
    }).processNextQueuedMessage = (id) => {
      queued.push(id)
    }

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(queued).toEqual([sessionId])
    expect(continuations).toEqual([])
  })

  it('runs a goal continuation without adding a fake user message', async () => {
    const sessionId = 'goal-hidden-turn'
    const managed = buildSession(sessionId)
    managed.goalState = goal({
      status: 'improving',
      iteration: 1,
      maxIterations: 3,
      criteria: [],
    })
    captureEvents()
    const prompts: string[] = []

    ;(sm as unknown as {
      getOrCreateAgent: () => Promise<{
        chat: (prompt: string, attachments: unknown[]) => AsyncGenerator<unknown>
        getSessionId: () => string
      }>
    }).getOrCreateAgent = async () => ({
      chat: async function* (prompt: string, attachments: unknown[]) {
        prompts.push(`${prompt} attachments:${attachments.length}`)
        yield {
          type: 'text_complete',
          text: 'Improved report complete.',
          isIntermediate: false,
        }
        yield { type: 'complete' }
      },
      getSessionId: () => 'sdk-hidden-turn',
    })

    await (sm as unknown as {
      runGoalContinuation: (sessionId: string, prompt: string, iteration: number) => Promise<void>
    }).runGoalContinuation(sessionId, '<goal-audit>improve</goal-audit>', 1)

    expect(prompts).toEqual(['<goal-audit>improve</goal-audit> attachments:0'])
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['write a report'])
    expect(managed.messages.some(m => m.role === 'info' && m.content.includes('Goal audit requested'))).toBe(true)
    expect(managed.messages.some(m => m.role === 'assistant' && m.content === 'Improved report complete.')).toBe(true)
  })

  it('uses the session agent reviewer to pass explicit criteria before completing', async () => {
    const sessionId = 'goal-reviewer-pass'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()
    const reviewPrompts: string[] = []

    managed.agent = {
      runMiniCompletion: async (prompt: string) => {
        reviewPrompts.push(prompt)
        return JSON.stringify({
          status: 'pass',
          summary: 'The response satisfies the explicit citation requirement.',
          missingCriteria: [],
        })
      },
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(reviewPrompts).toHaveLength(1)
    expect(reviewPrompts[0]).toContain('The final report cites the source spreadsheet.')
    expect(managed.goalState?.status).toBe('passed')
    expect(events.some(event => event.type === 'goal_completed')).toBe(true)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(false)
    expect(events.some(event => event.type === 'complete')).toBe(true)
  })

  it('initializes an auto_improve goal for a first work-like user message', async () => {
    const sessionId = 'goal-auto-init-work'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '请生成一份带验证结论的项目分析报告').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.objective).toBe('请生成一份带验证结论的项目分析报告')
    expect(managed.goalState?.criteria.some(criterion => criterion.required)).toBe(true)
  })

  it('does not initialize a goal for a first casual chat message', async () => {
    const sessionId = 'goal-auto-init-chat'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '你好').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState).toBeUndefined()
  })
})
