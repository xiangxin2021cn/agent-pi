import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { GoalController } from './goal-controller'

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
    mode: 'check_only',
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
    iteration: 0,
    maxIterations: 2,
    criteria: [],
    auditHistory: [],
    ...overrides,
  }
}

describe('GoalController', () => {
  test('skips when no goal state is present', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(undefined, {
      messages: [],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision).toEqual({ action: 'skip' })
  })

  test('passes when a complete turn produced a final assistant message and no required criteria', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.goalState.status).toBe('passed')
      expect(decision.result.status).toBe('pass')
      expect(decision.goalState.auditHistory).toHaveLength(1)
    }
  })

  test('needs review when no final assistant message was produced', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [message('u1', 'user', 'write a report')],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('No final assistant response was produced in this turn.')
    }
  })

  test('needs review when deterministic checks cannot prove explicit criteria', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('uncertain')
      expect(decision.result.missingCriteria).toContain('The final report cites the source spreadsheet.')
    }
  })

  test('passes when reviewer proves explicit criteria', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete with source spreadsheet citation.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'All explicit criteria are satisfied.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.status).toBe('pass')
      expect(decision.result.summary).toBe('All explicit criteria are satisfied.')
      expect(decision.result.missingCriteria).toEqual([])
    }
  })

  test('does not accept a reviewer pass that still reports missing criteria', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete, but the citation is still missing.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('uncertain')
      expect(decision.result.missingCriteria).toEqual(['The final report cites the source spreadsheet.'])
      expect(decision.prompt).toContain('The final report cites the source spreadsheet.')
    }
  })

  test('continues automatically for auto_improve goals when reviewer finds missing criteria', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'fail',
        summary: 'The citation is missing.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        correctivePrompt: 'Add a concrete citation to the source spreadsheet.',
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.goalState.status).toBe('improving')
      expect(decision.result.status).toBe('fail')
      expect(decision.result.summary).toBe('The citation is missing.')
      expect(decision.prompt).toContain('Add a concrete citation')
    }
  })

  test('continues automatically for auto_improve goals when explicit criteria need another pass', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.goalState.status).toBe('improving')
      expect(decision.result.status).toBe('uncertain')
      expect(decision.result.correctivePrompt).toBe(decision.prompt)
      expect(decision.prompt).toContain('Create a complete deliverable')
      expect(decision.prompt).toContain('The final report cites the source spreadsheet.')
    }
  })

  test('includes audit evidence in automatic improvement prompts', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the generated report file.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/report.md' },
        }),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Audit evidence:')
      expect(decision.prompt).toContain('/tmp/report.md')
    }
  })

  test('stops for review when auto_improve reaches max iterations', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 2,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.reason).toContain('maximum goal iterations')
    }
  })

  test('does not auto-continue after tool failures', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report'),
        message('t1', 'tool', 'failed', { toolStatus: 'error', toolName: 'Read' }),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.reason).toContain('errors')
    }
  })

  test('records file evidence from file-oriented tool input', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write a report file'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/report.md' },
        }),
        message('a1', 'assistant', 'Report file complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'Write',
        detail: '/tmp/report.md',
      })
    }
  })

  test('uses turnStartFinalMessageId to audit only the latest turn', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('old-a', 'assistant', 'Previous answer'),
        message('u1', 'user', 'new work'),
      ],
      turnStartFinalMessageId: 'old-a',
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
  })
})
