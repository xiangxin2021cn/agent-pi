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

  it('can disable an existing goal loop before completion audits', async () => {
    const sessionId = 'goal-disable'
    const managed = buildSession(sessionId)
    const events = captureEvents()
    const continuations: string[] = []

    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string) => void
    }).scheduleGoalContinuation = (id) => {
      continuations.push(id)
    }

    sm.setSessionGoalMode(sessionId, 'off')

    expect(managed.goalState?.mode).toBe('off')
    expect(managed.goalState?.status).toBe('cancelled')
    expect(events.some(event => event.type === 'goal_state_changed')).toBe(true)

    events.length = 0
    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(continuations).toEqual([])
    expect(events.some(event => event.type === 'goal_audit_result')).toBe(false)
    expect(events.some(event => event.type === 'complete')).toBe(true)
  })

  it('re-enables a cancelled goal loop as running work', () => {
    const sessionId = 'goal-re-enable'
    const managed = buildSession(sessionId)
    const events = captureEvents()

    sm.setSessionGoalMode(sessionId, 'off')
    events.length = 0
    sm.setSessionGoalMode(sessionId, 'auto_improve')

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.status).toBe('running')
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.status === 'running'
    )).toBe(true)
  })

  it('uses the session agent reviewer to pass explicit criteria before completing', async () => {
    const sessionId = 'goal-reviewer-pass'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    managed.messages.splice(1, 0, {
      id: 't1',
      role: 'tool',
      content: 'read source',
      timestamp: 1,
      toolName: 'Read',
      toolInput: { file_path: '/tmp/source.xlsx' },
      toolResult: 'loaded source rows from the spreadsheet',
    })
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
    expect(reviewPrompts[0]).toContain('Recent turn context:')
    expect(reviewPrompts[0]).toContain('user: write a report')
    expect(reviewPrompts[0]).toContain('tool Read: loaded source rows from the spreadsheet')
    expect(reviewPrompts[0]).toContain('The final report cites the source spreadsheet.')
    expect(reviewPrompts[0]).toContain('/tmp/source.xlsx')
    expect(reviewPrompts[0]).toContain('When status is "pass", missingCriteria must be [] and correctivePrompt must be omitted.')
    expect(reviewPrompts[0]).toContain('If any criterion is missing or any correctivePrompt is needed, status must not be "pass".')
    expect(managed.goalState?.status).toBe('passed')
    expect(events.some(event => event.type === 'goal_completed')).toBe(true)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(false)
    expect(events.some(event => event.type === 'complete')).toBe(true)
  })

  it('includes previous audit history in the reviewer prompt', async () => {
    const sessionId = 'goal-reviewer-history'
    const managed = buildSession(sessionId)
    managed.goalState = goal({
      mode: 'check_only',
      iteration: 1,
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'The spreadsheet citation was still missing.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        correctivePrompt: 'Add a concrete citation to source.xlsx.',
        evidence: [{
          type: 'file',
          label: 'Read',
          detail: '/tmp/source.xlsx',
        }],
        createdAt: 5,
      }],
    })
    captureEvents()
    const reviewPrompts: string[] = []

    managed.agent = {
      runMiniCompletion: async (prompt: string) => {
        reviewPrompts.push(prompt)
        return JSON.stringify({
          status: 'pass',
          summary: 'The response now satisfies the explicit citation requirement.',
          missingCriteria: [],
        })
      },
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(reviewPrompts).toHaveLength(1)
    expect(reviewPrompts[0]).toContain('Previous goal audits:')
    expect(reviewPrompts[0]).toContain('Iteration 1: fail - The spreadsheet citation was still missing.')
    expect(reviewPrompts[0]).toContain('Missing: The final report cites the source spreadsheet.')
    expect(reviewPrompts[0]).toContain('Correction: Add a concrete citation to source.xlsx.')
  })

  it('does not complete when reviewer pass has malformed missing criteria', async () => {
    const sessionId = 'goal-reviewer-malformed-pass'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but the citation is still missing.',
        missingCriteria: 'The final report cites the source spreadsheet.',
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('does not complete when reviewer pass has object-shaped missing criteria', async () => {
    const sessionId = 'goal-reviewer-object-missing'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but the citation is still missing.',
        missingCriteria: [{ text: 'The final report cites the source spreadsheet.' }],
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('does not complete when reviewer pass has root object missing criteria', async () => {
    const sessionId = 'goal-reviewer-root-object-missing'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but the citation is still missing.',
        missingCriteria: { text: 'The final report cites the source spreadsheet.' },
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('does not complete when reviewer pass has malformed corrective prompt', async () => {
    const sessionId = 'goal-reviewer-malformed-correction'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but add a citation.',
        missingCriteria: [],
        correctivePrompt: ['Add a concrete citation to source.xlsx.'],
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('does not complete when reviewer pass has object-shaped corrective prompt', async () => {
    const sessionId = 'goal-reviewer-object-correction'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but add a citation.',
        missingCriteria: [],
        correctivePrompt: { text: 'Add a concrete citation to source.xlsx.' },
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('does not complete when reviewer pass has object-array corrective prompt', async () => {
    const sessionId = 'goal-reviewer-object-array-correction'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'pass',
        summary: 'Looks complete, but add a citation.',
        missingCriteria: [],
        correctivePrompt: [{ text: 'Add a concrete citation to source.xlsx.' }],
      }),
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_completed')).toBe(false)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
  })

  it('continues when reviewer returns a needs_review status alias with a correction', async () => {
    const sessionId = 'goal-reviewer-status-alias'
    const managed = buildSession(sessionId)
    const events = captureEvents()
    const continuations: Array<{ sessionId: string; prompt: string; iteration: number }> = []

    managed.agent = {
      runMiniCompletion: async () => JSON.stringify({
        status: 'needs_review',
        summary: 'The citation still needs to be added.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        correctivePrompt: 'Add a concrete citation to source.xlsx.',
      }),
    } as never
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
    expect(continuations[0].prompt).toContain('Add a concrete citation to source.xlsx.')
    expect(managed.goalState?.status).toBe('improving')
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(false)
  })

  it('emits goal audit started before waiting for the reviewer result', async () => {
    const sessionId = 'goal-reviewer-started-before-await'
    const managed = buildSession(sessionId)
    const events = captureEvents()
    let reviewerStarted!: () => void
    let resolveReview!: (value: string) => void
    const reviewerStartedPromise = new Promise<void>(resolve => {
      reviewerStarted = resolve
    })
    const reviewResultPromise = new Promise<string>(resolve => {
      resolveReview = resolve
    })

    managed.agent = {
      runMiniCompletion: async () => {
        reviewerStarted()
        return reviewResultPromise
      },
    } as never

    const stopped = (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    await reviewerStartedPromise

    expect(events.some(event => event.type === 'goal_audit_started')).toBe(true)

    resolveReview(JSON.stringify({
      status: 'pass',
      summary: 'The response satisfies the explicit criteria.',
      missingCriteria: [],
    }))
    await stopped
  })

  it('times out a hung goal reviewer and completes the session for manual review', async () => {
    const sessionId = 'goal-reviewer-timeout'
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    const events = captureEvents()
    const originalSetTimeout = globalThis.setTimeout
    const immediateLongTimers = ((...args: Parameters<typeof setTimeout>) => {
      const [handler, timeout, ...rest] = args
      const delay = typeof timeout === 'number' && timeout >= 1000 ? 0 : timeout
      return originalSetTimeout(handler, delay, ...rest)
    }) as typeof setTimeout

    managed.agent = {
      runMiniCompletion: async () => new Promise<string | null>(() => {}),
    } as never

    try {
      globalThis.setTimeout = immediateLongTimers
      const stopped = (sm as unknown as {
        onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
      }).onProcessingStopped(sessionId, 'complete')
      const outcome = await Promise.race([
        stopped.then(() => 'resolved' as const),
        new Promise<'hung'>(resolve => originalSetTimeout(() => resolve('hung'), 50)),
      ])

      expect(outcome).toBe('resolved')
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }

    expect(managed.goalState?.status).toBe('needs_review')
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(true)
    expect(events.some(event => event.type === 'complete')).toBe(true)
    expect(events.some(event =>
      event.type === 'goal_audit_result'
      && event.result.evidence.some(item => item.label === 'reviewer_error')
    )).toBe(true)
  })

  it('initializes an auto_improve goal for a first work-like user message', async () => {
    const sessionId = 'goal-auto-init-work'
    const managed = buildSession(sessionId, { goalState: undefined })
    const events = captureEvents()

    await sm.sendMessage(sessionId, '请生成一份带验证结论的项目分析报告').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.maxIterations).toBe(2)
    expect(managed.goalState?.budgets?.maxWallClockMs).toBe(15 * 60 * 1000)
    expect(managed.goalState?.objective).toBe('请生成一份带验证结论的项目分析报告')
    expect(managed.goalState?.criteria.map(criterion => criterion.kind)).toEqual(['deliverable', 'format', 'test'])
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.id === managed.goalState?.id
    )).toBe(true)
  })

  it('uses a larger goal loop budget when the first work request asks to continue until done', async () => {
    const sessionId = 'goal-auto-init-until-done'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '请反复检查并继续改进，直到成果满足要求再结束').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.maxIterations).toBe(4)
    expect(managed.goalState?.budgets?.maxWallClockMs).toBe(45 * 60 * 1000)
  })

  it('initializes a goal when the first work-like request follows casual chat', async () => {
    const sessionId = 'goal-auto-init-after-chat'
    const managed = buildSession(sessionId, { goalState: undefined })
    managed.messages.push(
      message('u1', 'user', '你好'),
      message('a1', 'assistant', '你好，有什么可以帮你？'),
    )
    captureEvents()

    await sm.sendMessage(sessionId, '请整理一份项目分析报告').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.objective).toBe('请整理一份项目分析报告')
  })

  it('initializes a goal for source-sensitive risk review requests', async () => {
    const sessionId = 'goal-auto-init-source-risk'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '招标文件条款有哪些风险？').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('auto_improve')
    expect(managed.goalState?.objective).toBe('招标文件条款有哪些风险？')
    expect(managed.goalState?.criteria.map(criterion => criterion.kind)).toContain('evidence')
    expect(managed.goalState?.criteria.some(criterion => criterion.text.includes('Ground key facts'))).toBe(true)
  })

  it('adds follow-up work constraints to an existing goal', async () => {
    const sessionId = 'goal-update-follow-up'
    const managed = buildSession(sessionId, {
      goalState: goal({
        objective: '请整理一份项目分析报告',
        criteria: [{
          id: 'crit-1',
          text: 'Complete the user request.',
          kind: 'deliverable',
          required: true,
        }],
      }),
    })
    const events = captureEvents()

    await sm.sendMessage(sessionId, '另外请验证结果并引用 source.xlsx').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.objective).toContain('Follow-up: 另外请验证结果并引用 source.xlsx')
    expect(managed.goalState?.status).toBe('running')
    expect(managed.goalState?.criteria.map(criterion => criterion.kind)).toContain('user_constraint')
    expect(managed.goalState?.criteria.map(criterion => criterion.kind)).toContain('test')
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.id === managed.goalState?.id
    )).toBe(true)
  })

  it('extends the goal loop budget when the user resumes a goal that reached review', async () => {
    const sessionId = 'goal-update-budget-after-review'
    const managed = buildSession(sessionId, {
      goalState: goal({
        createdAt: Date.now(),
        status: 'needs_review',
        iteration: 2,
        maxIterations: 2,
      }),
    })
    captureEvents()

    await sm.sendMessage(sessionId, '继续修复并验证结果').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.status).toBe('running')
    expect(managed.goalState?.maxIterations).toBe(4)
    expect(managed.goalState?.budgets?.maxWallClockMs).toBeGreaterThanOrEqual(15 * 60 * 1000)
    expect(managed.goalState?.budgets?.maxWallClockMs).toBeLessThan(16 * 60 * 1000)
  })

  it('extends an old goal wall-clock budget from the follow-up time', async () => {
    const sessionId = 'goal-update-old-wall-clock-budget'
    const twentyMinutesMs = 20 * 60 * 1000
    const managed = buildSession(sessionId, {
      goalState: goal({
        createdAt: Date.now() - twentyMinutesMs,
        status: 'needs_review',
        iteration: 2,
        maxIterations: 2,
        budgets: { maxWallClockMs: 15 * 60 * 1000 },
      }),
    })
    captureEvents()

    await sm.sendMessage(sessionId, '继续修复并验证结果').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.status).toBe('running')
    expect(managed.goalState?.budgets?.maxWallClockMs).toBeGreaterThanOrEqual(35 * 60 * 1000)
  })

  it('does not add casual follow-up chat to an existing goal', async () => {
    const sessionId = 'goal-ignore-casual-follow-up'
    const managed = buildSession(sessionId)
    const originalGoal = managed.goalState
    captureEvents()

    await sm.sendMessage(sessionId, '谢谢').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState).toBe(originalGoal)
  })

  it('does not initialize a goal for a first casual chat message', async () => {
    const sessionId = 'goal-auto-init-chat'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '你好').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState).toBeUndefined()
  })
})
