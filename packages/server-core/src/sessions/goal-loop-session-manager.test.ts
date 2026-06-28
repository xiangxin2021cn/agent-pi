import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import { FORMAL_OUTPUTS_DIR_NAME, type SessionGoalState } from '@craft-agent/shared/sessions'
import type { SessionEvent } from '@craft-agent/shared/protocol'
import { saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import { FILE_OUTPUT_REQUIRED_CRITERION_TEXT } from './goal-criteria'

function message(id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    ...extra,
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

  function saveWorkspaceGoalLoopDefault(goalLoop: unknown) {
    saveWorkspaceConfig(tmpRoot, {
      id: 'ws_test',
      name: 'Test Workspace',
      slug: 'test-workspace',
      defaults: { goalLoop } as never,
      createdAt: 1,
      updatedAt: 1,
    })
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

  it('continues automatically when a claimed output file is missing on disk', async () => {
    const sessionId = 'goal-missing-file-evidence'
    const missingPath = join(tmpRoot, 'missing-report.md')
    const managed = buildSession(sessionId, {
      goalState: goal({ mode: 'auto_improve', criteria: [] }),
    })
    managed.messages.push(
      message('u2', 'user', 'write a report file'),
      message('t2', 'tool', 'created', {
        toolName: 'Write',
        toolStatus: 'completed',
        toolInput: { file_path: missingPath },
      }),
      message('a2', 'assistant', 'Report file complete.'),
    )
    const events = captureEvents()
    let scheduledPrompt = ''
    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string, prompt: string, iteration: number) => void
    }).scheduleGoalContinuation = (_id, prompt) => {
      scheduledPrompt = prompt
    }

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('improving')
    expect(managed.goalState?.auditHistory.at(-1)?.missingCriteria).toContain(`Referenced file was not found: ${missingPath}`)
    expect(scheduledPrompt).toContain(`Referenced file was not found: ${missingPath}`)
    expect(events.some(event => event.type === 'complete')).toBe(false)
  })

  it('continues automatically when a requested output file is outside the formal output directory', async () => {
    const sessionId = 'goal-wrong-output-directory'
    const workingDirectory = join(tmpRoot, 'project')
    const expectedOutputDirectory = join(workingDirectory, FORMAL_OUTPUTS_DIR_NAME, sessionId)
    const wrongPath = join(tmpRoot, 'final-report.md')
    mkdirSync(workingDirectory, { recursive: true })
    writeFileSync(wrongPath, 'report')
    const managed = buildSession(sessionId, {
      goalState: goal({
        mode: 'auto_improve',
        criteria: [{
          id: 'crit-file-output',
          text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
          kind: 'deliverable',
          required: true,
        }],
      }),
    })
    managed.workingDirectory = workingDirectory
    managed.messages.push(
      message('u2', 'user', 'write a final report file'),
      message('t2', 'tool', 'created', {
        toolName: 'Write',
        toolStatus: 'completed',
        toolInput: { file_path: wrongPath },
      }),
      message('a2', 'assistant', 'Final report file complete.'),
    )
    const events = captureEvents()
    let scheduledPrompt = ''
    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string, prompt: string, iteration: number) => void
    }).scheduleGoalContinuation = (_id, prompt) => {
      scheduledPrompt = prompt
    }

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(managed.goalState?.status).toBe('improving')
    expect(managed.goalState?.auditHistory.at(-1)?.missingCriteria.some(criterion =>
      criterion.includes(`Requested output file was not written to the formal output directory: ${wrongPath}`)
    )).toBe(true)
    expect(scheduledPrompt).toContain(expectedOutputDirectory)
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

  it('reuses the last sent attachments for a hidden goal continuation', async () => {
    const sessionId = 'goal-hidden-turn-attachments'
    const managed = buildSession(sessionId)
    const sourcePath = join(tmpRoot, 'tender.pdf')
    managed.goalState = goal({
      status: 'improving',
      iteration: 1,
      maxIterations: 3,
      criteria: [],
    })
    managed.lastSentAttachments = [{
      type: 'pdf',
      path: sourcePath,
      name: 'tender.pdf',
      mimeType: 'application/pdf',
      size: 100,
    }]
    captureEvents()
    const seenAttachments: unknown[] = []

    ;(sm as unknown as {
      getOrCreateAgent: () => Promise<{
        chat: (prompt: string, attachments: unknown[]) => AsyncGenerator<unknown>
        getSessionId: () => string
      }>
    }).getOrCreateAgent = async () => ({
      chat: async function* (_prompt: string, attachments: unknown[]) {
        seenAttachments.push(attachments)
        yield {
          type: 'text_complete',
          text: 'Improved report with tender evidence.',
          isIntermediate: false,
        }
        yield { type: 'complete' }
      },
      getSessionId: () => 'sdk-hidden-turn-attachments',
    })

    await (sm as unknown as {
      runGoalContinuation: (sessionId: string, prompt: string, iteration: number) => Promise<void>
    }).runGoalContinuation(sessionId, '<goal-audit>improve with source</goal-audit>', 1)

    expect(seenAttachments).toEqual([managed.lastSentAttachments])
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['write a report'])
  })

  it('restores persisted user attachments for a hidden goal continuation', async () => {
    const sessionId = 'goal-hidden-turn-stored-attachments'
    const managed = buildSession(sessionId)
    const sourcePath = join(tmpRoot, 'tender.pdf')
    writeFileSync(sourcePath, '%PDF-1.4\n')
    managed.goalState = goal({
      status: 'improving',
      iteration: 1,
      maxIterations: 3,
      criteria: [],
    })
    managed.lastSentAttachments = undefined
    managed.lastSentStoredAttachments = undefined
    const userMessage = managed.messages.find(m => m.role === 'user')
    userMessage!.attachments = [{
      id: 'att-1',
      type: 'pdf',
      name: 'tender.pdf',
      mimeType: 'application/pdf',
      size: 9,
      storedPath: sourcePath,
    }]
    captureEvents()
    const seenAttachments: Array<Array<{ path: string; name: string; type: string }>> = []

    ;(sm as unknown as {
      getOrCreateAgent: () => Promise<{
        chat: (prompt: string, attachments: Array<{ path: string; name: string; type: string }>) => AsyncGenerator<unknown>
        getSessionId: () => string
      }>
    }).getOrCreateAgent = async () => ({
      chat: async function* (_prompt: string, attachments: Array<{ path: string; name: string; type: string }>) {
        seenAttachments.push(attachments)
        yield {
          type: 'text_complete',
          text: 'Improved report with restored attachment evidence.',
          isIntermediate: false,
        }
        yield { type: 'complete' }
      },
      getSessionId: () => 'sdk-hidden-turn-stored-attachments',
    })

    await (sm as unknown as {
      runGoalContinuation: (sessionId: string, prompt: string, iteration: number) => Promise<void>
    }).runGoalContinuation(sessionId, '<goal-audit>improve with restored source</goal-audit>', 1)

    expect(seenAttachments[0]).toMatchObject([{
      path: sourcePath,
      name: 'tender.pdf',
      type: 'pdf',
    }])
    expect(managed.messages.filter(m => m.role === 'user').map(m => m.content)).toEqual(['write a report'])
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

  it('accepts a needs-review goal as done without scheduling another pass', () => {
    const sessionId = 'goal-accept'
    const managed = buildSession(sessionId, {
      goalState: goal({
        status: 'needs_review',
        iteration: 2,
        maxIterations: 2,
      }),
    })
    const events = captureEvents()
    const continuations: string[] = []

    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string) => void
    }).scheduleGoalContinuation = (id) => {
      continuations.push(id)
    }

    ;(sm as unknown as {
      acceptSessionGoal: (sessionId: string) => void
    }).acceptSessionGoal(sessionId)

    expect(managed.goalState?.status).toBe('passed')
    expect(continuations).toEqual([])
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.status === 'passed'
    )).toBe(true)
    expect(events.some(event => event.type === 'goal_completed')).toBe(true)
  })

  it('runs one manual improvement pass from a needs-review audit', () => {
    const sessionId = 'goal-manual-improve'
    const managed = buildSession(sessionId, {
      goalState: goal({
        status: 'needs_review',
        iteration: 2,
        maxIterations: 5,
        auditHistory: [{
          iteration: 2,
          status: 'fail',
          summary: 'The spreadsheet citation is still missing.',
          missingCriteria: ['The final report cites the source spreadsheet.'],
          correctivePrompt: 'Add a concrete citation to source.xlsx.',
          evidence: [],
          createdAt: 5,
        }],
      }),
    })
    const events = captureEvents()
    const continuations: Array<{ sessionId: string; prompt: string; iteration: number }> = []

    ;(sm as unknown as {
      scheduleGoalContinuation: (sessionId: string, prompt: string, iteration: number) => void
    }).scheduleGoalContinuation = (id, prompt, iteration) => {
      continuations.push({ sessionId: id, prompt, iteration })
    }

    ;(sm as unknown as {
      runSessionGoalImprovement: (sessionId: string) => void
    }).runSessionGoalImprovement(sessionId)

    expect(managed.goalState?.status).toBe('improving')
    expect(managed.goalState?.iteration).toBe(2)
    expect(managed.goalState?.maxIterations).toBe(3)
    expect(continuations).toHaveLength(1)
    expect(continuations[0].sessionId).toBe(sessionId)
    expect(continuations[0].iteration).toBe(2)
    expect(continuations[0].prompt).toContain('Add a concrete citation to source.xlsx.')
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.status === 'improving'
    )).toBe(true)
  })

  it('updates goal objective and acceptance criteria for manual review', () => {
    const sessionId = 'goal-update-criteria'
    const managed = buildSession(sessionId, {
      goalState: goal({
        status: 'passed',
        iteration: 1,
        criteria: [{
          id: 'crit-existing',
          text: 'Old citation requirement.',
          kind: 'evidence',
          required: true,
        }],
      }),
    })
    const events = captureEvents()

    ;(sm as unknown as {
      updateSessionGoal: (
        sessionId: string,
        update: {
          objective: string
          criteria: Array<{ id?: string; text: string; kind?: 'evidence' | 'user_constraint'; required?: boolean }>
        },
      ) => void
    }).updateSessionGoal(sessionId, {
      objective: '  Revised deliverable objective  ',
      criteria: [
        {
          id: 'crit-existing',
          text: '  Cite source.xlsx for key facts.  ',
          kind: 'evidence',
          required: true,
        },
        {
          text: 'Include a concise final summary.',
          required: true,
        },
      ],
    })

    expect(managed.goalState?.objective).toBe('Revised deliverable objective')
    expect(managed.goalState?.status).toBe('needs_review')
    expect(managed.goalState?.criteria).toHaveLength(2)
    expect(managed.goalState?.criteria[0]).toMatchObject({
      id: 'crit-existing',
      text: 'Cite source.xlsx for key facts.',
      kind: 'evidence',
      required: true,
    })
    expect(managed.goalState?.criteria[1].id).toBeTruthy()
    expect(managed.goalState?.criteria[1]).toMatchObject({
      text: 'Include a concise final summary.',
      kind: 'user_constraint',
      required: true,
    })
    expect(events.some(event =>
      event.type === 'goal_state_changed'
      && event.goalState.status === 'needs_review'
    )).toBe(true)
  })

  it('rejects empty goal criteria edits', () => {
    const sessionId = 'goal-empty-criteria'
    const managed = buildSession(sessionId)
    const originalGoal = managed.goalState

    expect(() => {
      ;(sm as unknown as {
        updateSessionGoal: (
          sessionId: string,
          update: { objective: string; criteria: Array<{ text: string }> },
        ) => void
      }).updateSessionGoal(sessionId, {
        objective: 'Revised objective',
        criteria: [{ text: '   ' }],
      })
    }).toThrow('At least one goal criterion is required')
    expect(managed.goalState).toBe(originalGoal)
  })

  it('uses the session agent reviewer to pass explicit criteria before completing', async () => {
    const sessionId = 'goal-reviewer-pass'
    const sourcePath = join(tmpRoot, 'source.xlsx')
    writeFileSync(sourcePath, 'source rows')
    const managed = buildSession(sessionId)
    managed.goalState = goal({ mode: 'check_only' })
    managed.messages.splice(1, 0, {
      id: 't1',
      role: 'tool',
      content: 'read source',
      timestamp: 1,
      toolName: 'Read',
      toolInput: { file_path: sourcePath },
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
    expect(reviewPrompts[0]).toContain(sourcePath)
    expect(reviewPrompts[0]).toContain('When status is "pass", missingCriteria must be [] and correctivePrompt must be omitted.')
    expect(reviewPrompts[0]).toContain('If any criterion is missing or any correctivePrompt is needed, status must not be "pass".')
    expect(managed.goalState?.status).toBe('passed')
    expect(events.some(event => event.type === 'goal_completed')).toBe(true)
    expect(events.some(event => event.type === 'goal_needs_review')).toBe(false)
    expect(events.some(event => event.type === 'complete')).toBe(true)
  })

  it('includes verified text output file previews in the reviewer prompt', async () => {
    const sessionId = 'goal-reviewer-output-preview'
    const workingDirectory = join(tmpRoot, 'project')
    const outputDirectory = join(workingDirectory, FORMAL_OUTPUTS_DIR_NAME, sessionId)
    const outputPath = join(outputDirectory, 'final-report.md')
    mkdirSync(outputDirectory, { recursive: true })
    writeFileSync(outputPath, 'Executive summary\nKey risk: missing permits.\nRecommended next action.')

    const managed = buildSession(sessionId, {
      goalState: goal({
        mode: 'check_only',
        criteria: [{
          id: 'crit-file-output',
          text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
          kind: 'deliverable',
          required: true,
        }, {
          id: 'crit-quality',
          text: 'The final report includes an executive summary and risk section.',
          kind: 'coverage',
          required: true,
        }],
      }),
    })
    managed.workingDirectory = workingDirectory
    managed.messages.splice(1, 0, message('t1', 'tool', 'created', {
      toolName: 'Write',
      toolStatus: 'completed',
      toolInput: { file_path: outputPath },
    }))
    captureEvents()
    const reviewPrompts: string[] = []

    managed.agent = {
      runMiniCompletion: async (prompt: string) => {
        reviewPrompts.push(prompt)
        return JSON.stringify({
          status: 'pass',
          summary: 'The output file satisfies the requested content.',
          missingCriteria: [],
        })
      },
    } as never

    await (sm as unknown as {
      onProcessingStopped: (sessionId: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(reviewPrompts).toHaveLength(1)
    expect(reviewPrompts[0]).toContain('file_preview')
    expect(reviewPrompts[0]).toContain('Executive summary')
    expect(reviewPrompts[0]).toContain('Key risk: missing permits.')
    expect(managed.goalState?.status).toBe('passed')
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
    expect(managed.goalState?.status).toBe('auditing')
    expect(managed.goalState?.iteration).toBe(1)

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

  it('does not auto-initialize a goal when the workspace goal loop default is off', async () => {
    saveWorkspaceGoalLoopDefault({ defaultMode: 'off' })
    const sessionId = 'goal-workspace-default-off'
    const managed = buildSession(sessionId, { goalState: undefined })
    const events = captureEvents()

    await sm.sendMessage(sessionId, '请生成一份带验证结论的项目分析报告').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState).toBeUndefined()
    expect(events.some(event => event.type === 'goal_state_changed')).toBe(false)
  })

  it('initializes a check-only goal when the workspace goal loop default is check_only', async () => {
    saveWorkspaceGoalLoopDefault({ defaultMode: 'check_only' })
    const sessionId = 'goal-workspace-default-check-only'
    const managed = buildSession(sessionId, { goalState: undefined })
    captureEvents()

    await sm.sendMessage(sessionId, '请生成一份带验证结论的项目分析报告').catch(() => { /* expected after pre-agent setup */ })

    expect(managed.goalState?.mode).toBe('check_only')
    expect(managed.goalState?.maxIterations).toBe(1)
    expect(managed.goalState?.objective).toBe('请生成一份带验证结论的项目分析报告')
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
