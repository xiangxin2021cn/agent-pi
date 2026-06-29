import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { GoalController } from './goal-controller'
import { COMPREHENSIVE_QUALITY_CRITERION_TEXT, FILE_OUTPUT_REQUIRED_CRITERION_TEXT, TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT } from './goal-criteria'

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

  test('does not accept reviewer pass when required source citation markers are missing', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-source-citation',
        text: 'Use and cite the referenced input material where relevant: tender.md.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'Summarize the tender mobilization requirement.', {
          attachments: [{
            id: 'att-1',
            type: 'text',
            name: 'tender.md',
            mimeType: 'text/markdown',
            size: 58,
            storedPath: '/tmp/tender.md',
          }],
        }),
        message('a1', 'assistant', 'The mobilization period is 14 days.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({
        exists: true,
        readable: true,
        isFile: true,
        sizeBytes: 58,
        preview: 'Tender clause 4.2 requires a 14-day mobilization plan.',
      }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The answer is grounded in the source.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Final response did not include a source citation marker for required source evidence.')
      expect(decision.prompt).toContain('Final response did not include a source citation marker')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'source_file_preview',
        detail: '/tmp/tender.md\nTender clause 4.2 requires a 14-day mobilization plan.',
      })
    }
  })

  test('accepts required source citation markers from verified output previews', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-source-citation',
        text: 'Use and cite the referenced input material where relevant: tender.md.',
        kind: 'evidence',
        required: true,
      }, {
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'Write a cited report from the tender.', {
          attachments: [{
            id: 'att-1',
            type: 'text',
            name: 'tender.md',
            mimeType: 'text/markdown',
            size: 58,
            storedPath: '/tmp/tender.md',
          }],
        }),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/report.md' },
        }),
        message('a1', 'assistant', 'Saved the report.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async (filePath) => ({
        exists: true,
        readable: true,
        isFile: true,
        sizeBytes: 58,
        preview: filePath.endsWith('report.md')
          ? 'Mobilization period is 14 days.\n\n依据 tender.md: clause 4.2.'
          : 'Tender clause 4.2 requires a 14-day mobilization plan.',
      }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The cited report is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('complete')
    expect(reviewPrompts).toHaveLength(1)
    if (decision.action === 'complete') {
      expect(decision.result.status).toBe('pass')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_preview',
        detail: '/tmp/report.md\nMobilization period is 14 days.\n\n依据 tender.md: clause 4.2.',
      })
    }
  })

  test('does not accept reviewer pass for shallow comprehensive work output', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-quality',
        text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'Write a comprehensive report.'),
        message('a1', 'assistant', 'Done.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'Looks complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Substantive work product was not produced for the requested high-quality comprehensive deliverable.')
      expect(decision.prompt).toContain('Substantive work product was not produced')
      expect(decision.result.evidence).toContainEqual({
        type: 'message',
        label: 'substantive_content_missing',
        detail: 'a1',
      })
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

  test('does not accept a reviewer pass that still returns a corrective prompt', async () => {
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
        summary: 'Looks complete, but add a concrete citation.',
        missingCriteria: [],
        correctivePrompt: 'Add a concrete citation to the source spreadsheet.',
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('uncertain')
      expect(decision.prompt).toContain('Add a concrete citation to the source spreadsheet.')
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

  test('continues automatically when claimed file evidence is missing', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
    }), {
      messages: [
        message('u1', 'user', 'write a report file'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/missing-report.md' },
        }),
        message('a1', 'assistant', 'Report file complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({ exists: false, readable: false }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Referenced file was not found: /tmp/missing-report.md')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_missing',
        detail: '/tmp/missing-report.md',
      })
      expect(decision.prompt).toContain('Referenced file was not found: /tmp/missing-report.md')
    }
  })

  test('does not accept reviewer pass when requested output file has no file evidence', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成 final-report.md 文件'),
        message('a1', 'assistant', 'final-report.md 已生成。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The file output is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('No verifiable output file path was produced for the requested file deliverable.')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_evidence_missing',
        detail: 'No file path was captured from tool input or tool output.',
      })
      expect(decision.prompt).toContain('No verifiable output file path was produced')
    }
  })

  test('does not count source read paths as requested output file evidence', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请将 tender.pdf 转换为 markdown 文件'),
        message('t1', 'tool', 'read source', {
          toolName: 'Read',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/tender.pdf' },
          toolResult: 'Read /tmp/tender.pdf',
        }),
        message('a1', 'assistant', '已生成 tender.md。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({ exists: true, readable: true, isFile: true, sizeBytes: 100 }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The requested conversion is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('No verifiable output file path was produced for the requested file deliverable.')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'Read',
        detail: '/tmp/tender.pdf',
      })
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_evidence_missing',
        detail: 'No file path was captured from tool input or tool output.',
      })
    }
  })

  test('does not accept requested output files outside the formal output directory', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成 final-report.md 文件'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/final-report.md' },
        }),
        message('a1', 'assistant', 'final-report.md 已生成。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      expectedOutputDirectory: '/tmp/project/Agent Pi Outputs/session-1',
      fileVerifier: async () => ({ exists: true, readable: true, isFile: true, sizeBytes: 100 }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The file output is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria.some(criterion =>
        criterion.includes('Requested output file was not written to the formal output directory: /tmp/final-report.md')
      )).toBe(true)
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_wrong_output_directory',
        detail: '/tmp/final-report.md',
      })
      expect(decision.prompt).toContain('/tmp/project/Agent Pi Outputs/session-1')
    }
  })

  test('does not accept output files that do not match the requested format', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }, {
        id: 'crit-output-format',
        text: 'Create output file(s) in the requested format(s): PDF.',
        kind: 'format',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成 PDF 报告'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/report.md' },
        }),
        message('a1', 'assistant', 'PDF 报告已生成。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({ exists: true, readable: true, isFile: true, sizeBytes: 100 }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The requested PDF output is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Requested output format was not produced: PDF.')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_wrong_output_format',
        detail: '/tmp/report.md',
      })
    }
  })

  test('does not accept reviewer pass when destination output file evidence is missing on disk', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '导出最终 PDF 文件'),
        message('t1', 'tool', 'exported', {
          toolName: 'Export',
          toolStatus: 'completed',
          toolInput: { destination_path: '/tmp/final-report.pdf' },
        }),
        message('a1', 'assistant', 'PDF 已导出。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({ exists: false, readable: false }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The requested PDF export is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Referenced file was not found: /tmp/final-report.pdf')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'Export',
        detail: '/tmp/final-report.pdf',
      })
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_missing',
        detail: '/tmp/final-report.pdf',
      })
    }
  })

  test('records bounded file previews from verified output evidence', async () => {
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
      fileVerifier: async () => ({
        exists: true,
        readable: true,
        isFile: true,
        sizeBytes: 42,
        preview: 'Executive summary\nKey risk: missing permits.',
      }),
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_preview',
        detail: '/tmp/report.md\nExecutive summary\nKey risk: missing permits.',
      })
    }
  })

  test('records user attachments as source file evidence without satisfying output file evidence', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请将上传的 tender.pdf 转换为 markdown 文件', {
          attachments: [{
            id: 'att-1',
            type: 'pdf',
            name: 'tender.pdf',
            mimeType: 'application/pdf',
            size: 100,
            storedPath: '/tmp/tender.pdf',
          }],
        }),
        message('a1', 'assistant', '已生成 tender.md。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({
        exists: true,
        readable: true,
        isFile: true,
        sizeBytes: 100,
        preview: 'Tender clause 4.2 requires a 14-day mobilization plan.',
      }),
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The requested conversion is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('No verifiable output file path was produced for the requested file deliverable.')
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'user_attachment',
        detail: '/tmp/tender.pdf',
      })
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'file_verified',
        detail: '/tmp/tender.pdf (100 bytes)',
      })
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'source_file_preview',
        detail: '/tmp/tender.pdf\nTender clause 4.2 requires a 14-day mobilization plan.',
      })
    }
  })

  test('does not accept reviewer pass when requested verification has no tool evidence', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-tool-verification',
        text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
        kind: 'test',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请运行测试并确认通过'),
        message('a1', 'assistant', '测试已经通过。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'The requested verification is complete.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('continue')
    expect(reviewPrompts).toEqual([])
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('No successful tool evidence was produced for the requested verification step.')
      expect(decision.result.evidence).toContainEqual({
        type: 'tool',
        label: 'tool_verification_missing',
        detail: 'No completed verification, test, build, lint, typecheck, or validation tool run was captured.',
      })
      expect(decision.prompt).toContain('No successful tool evidence was produced')
    }
  })

  test('needs review when claimed file evidence is empty in check-only mode', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write a report file'),
        message('t1', 'tool', 'created', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/empty-report.md' },
        }),
        message('a1', 'assistant', 'Report file complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({ exists: true, readable: true, isFile: true, sizeBytes: 0 }),
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Referenced file is empty: /tmp/empty-report.md')
      expect(decision.reason).toContain('file evidence')
    }
  })

  test('includes previous audit history in automatic improvement prompts', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'The executive summary was still missing.',
        missingCriteria: ['The final report includes an executive summary.'],
        correctivePrompt: 'Add a concise executive summary.',
        evidence: [{
          type: 'file',
          label: 'Read',
          detail: '/tmp/source.xlsx',
        }],
        createdAt: 5,
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
      expect(decision.prompt).toContain('Previous goal audits:')
      expect(decision.prompt).toContain('Iteration 1: fail - The executive summary was still missing.')
      expect(decision.prompt).toContain('Correction: Add a concise executive summary.')
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

  test('stops for review when the same missing criteria repeat across audits', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 4,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'The citation is missing.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        correctivePrompt: 'Add a concrete citation to source.xlsx.',
        evidence: [],
        createdAt: 5,
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
        summary: 'The citation is still missing.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        correctivePrompt: 'Add a concrete citation to source.xlsx.',
      }),
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.reason).toContain('same goal audit failure')
      expect(decision.result.evidence).toContainEqual({
        type: 'system',
        label: 'repeated_goal_failure',
        detail: 'The same missing criteria were reported in consecutive audits.',
      })
    }
  })

  test('stops for review when the goal wall-clock budget is exhausted', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      createdAt: 0,
      maxIterations: 4,
      budgets: { maxWallClockMs: 1000 },
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
      now: 2000,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.reason).toContain('wall-clock')
    }
  })

  test('passes when a tool failure is resolved by a later successful run of the same tool', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'run tests and summarize the result'),
        message('t1', 'tool', 'tests failed', {
          toolStatus: 'error',
          toolName: 'Bash',
          isError: true,
          toolResult: 'npm test failed',
        }),
        message('t2', 'tool', 'tests passed', {
          toolStatus: 'completed',
          toolName: 'Bash',
          isError: false,
          toolResult: 'npm test passed',
        }),
        message('a1', 'assistant', 'Tests pass after fixing the issue.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.status).toBe('pass')
      expect(decision.result.missingCriteria).not.toContain('1 tool failure(s) were produced.')
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

  test('does not auto-continue after an interrupted turn even if partial output exists', async () => {
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
        message('a1', 'assistant', 'Partial report draft.'),
      ],
      stoppedReason: 'interrupted',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.reason).toContain('interrupted')
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

  test('records file evidence from tool result text when structured input lacks a path', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write a report file'),
        message('t1', 'tool', 'created C:\\work\\report.md', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { content: 'report' },
          toolResult: 'Created file: C:\\work\\report.md',
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
        detail: 'C:\\work\\report.md',
      })
    }
  })

  test('records file evidence from plural path arrays in tool input', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write report files'),
        message('t1', 'tool', 'created', {
          toolName: 'WriteMany',
          toolStatus: 'completed',
          toolInput: { paths: ['/tmp/report.md', 'C:\\work\\summary.xlsx'] },
        }),
        message('a1', 'assistant', 'Report files complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'WriteMany',
        detail: '/tmp/report.md',
      })
      expect(decision.result.evidence).toContainEqual({
        type: 'file',
        label: 'WriteMany',
        detail: 'C:\\work\\summary.xlsx',
      })
    }
  })

  test('records quoted file evidence with spaces from tool result text', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'write a report file'),
        message('t1', 'tool', 'created "C:\\Users\\xiang\\My Project\\final report.md"', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { content: 'report' },
          toolResult: 'Created file: "C:\\Users\\xiang\\My Project\\final report.md"',
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
        detail: 'C:\\Users\\xiang\\My Project\\final report.md',
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
