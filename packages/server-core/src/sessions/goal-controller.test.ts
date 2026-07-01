import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { GoalController } from './goal-controller'
import { COMPREHENSIVE_QUALITY_CRITERION_TEXT, DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT, FILE_OUTPUT_REQUIRED_CRITERION_TEXT, TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT } from './goal-criteria'

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

  test('does not accept reviewer pass for low-quality source-sensitive document work', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-document-quality',
        text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '根据附件生成投标分析报告', {
          attachments: [{
            id: 'att-1',
            type: 'pdf',
            name: 'tender.pdf',
            mimeType: 'application/pdf',
            size: 100,
            storedPath: '/tmp/tender.pdf',
          }],
        }),
        message('a1', 'assistant', '报告完成，主要风险都已经分析。'),
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
      expect(decision.result.missingCriteria.some(item => item.includes('Document quality audit did not pass'))).toBe(true)
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'document_quality_report'
        && (item.detail ?? '').includes('status: fail')
      )).toBe(true)
    }
  })

  test('passes document quality audit before reviewer decides remaining criteria', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []
    const reportContent = [
      '# 投标分析报告',
      '## 一、项目范围与资料依据',
      '本报告依据 tender.pdf 第 12 页的合同范围、BOQ 清单第 4 章的工程量项目，以及招标补遗中的工期要求形成。项目重点包括道路工程、结构工程、照明工程和社区参与安排。关键判断均按“来源、事实、影响、建议”四段记录，未见来源的内容明确列为假设。',
      '## 二、关键风险清单',
      '| 风险 | 来源 | 影响 | 建议 |',
      '| --- | --- | --- | --- |',
      '| 工期 60+3 个月但清单分部分项跨度较大 | tender.pdf 第 18 页 | 高峰资源投入可能集中 | 建议将道路、结构、照明分成独立流水段 |',
      '| BOQ 金额集中在道路工程 | BOQ 第 1200-4200 节 | 报价偏差会放大总价风险 | 建议复核材料、机械、运输和管理费假设 |',
      '## 三、数字与结论',
      '根据 BOQ 工作簿，Schedule A 约占 52.4%，Schedule B 约占 38.0%，其余照明和 CPG 占比较低。该分布说明成本控制重点应放在道路工程的土方、路面、沥青和排水项目，并将结构工程作为第二控制面。以上比例用于指导审查优先级，不替代最终报价测算。',
      '## 四、后续动作',
      '下一步应把 tender.pdf 的合同条款、BOQ 的高金额条目、规范中的材料要求建立成审查清单。所有正式施工方案引用时应保留来源文件名、章节或页码，无法确认的数据应进入问题清单等待人工确认。',
    ].join('\n\n')

    const decision = await controller.onTurnStopped(goal({
      criteria: [{
        id: 'crit-document-quality',
        text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '根据附件生成投标分析报告', {
          attachments: [{
            id: 'att-1',
            type: 'pdf',
            name: 'tender.pdf',
            mimeType: 'application/pdf',
            size: 100,
            storedPath: '/tmp/tender.pdf',
          }],
        }),
        message('a1', 'assistant', reportContent),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async (input) => {
        reviewPrompts.push(input.result.summary)
        return {
          status: 'pass',
          summary: 'Document quality and remaining criteria passed.',
          missingCriteria: [],
        }
      },
    })

    expect(decision.action).toBe('complete')
    expect(reviewPrompts).toHaveLength(1)
    if (decision.action === 'complete') {
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'document_quality_report'
        && (item.detail ?? '').includes('status: pass')
      )).toBe(true)
    }
  })

  test('does not accept reviewer pass when explicit required user item is missing', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-user-requirement',
        text: 'Must satisfy explicit user requirement: 风险清单.',
        kind: 'user_constraint',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请生成施工方案报告，必须包含风险清单。'),
        message('a1', 'assistant', '施工方案报告已完成，包含工程概况和施工部署。'),
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
      expect(decision.result.missingCriteria).toContain('Final response or verified output preview did not address explicit user requirement: 风险清单.')
      expect(decision.prompt).toContain('风险清单')
      expect(decision.result.evidence).toContainEqual({
        type: 'message',
        label: 'explicit_user_requirement_missing',
        detail: '风险清单',
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
      expect(decision.prompt).toContain('<goal-audit>')
      expect(decision.prompt).toContain('Reviewer correction:')
      expect(decision.prompt).toContain('Execution strategy:')
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

  test('uses failure categories to sharpen automatic improvement prompts', async () => {
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
        summary: 'The report is shallow and lacks citation evidence.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        failureCategories: ['evidence_gap', 'shallow_output'],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.failureCategories).toEqual(['evidence_gap', 'shallow_output'])
      expect(decision.prompt).toContain('Corrective focus:')
      expect(decision.prompt).toContain('Add concrete citations')
      expect(decision.prompt).toContain('Expand the deliverable')
    }
  })

  test('adds required checkpoints for evidence and verification gaps', async () => {
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
        message('u1', 'user', 'write a report and verify it'),
        message('a1', 'assistant', 'Report complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'fail',
        summary: 'The report lacks source evidence and verification output.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        failureCategories: ['evidence_gap', 'verification_gap'],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Required checkpoints:')
      expect(decision.prompt).toContain('Identify the exact source, file, artifact, or citation')
      expect(decision.prompt).toContain('Run the requested verification')
      expect(decision.prompt).toContain('Do not produce the final response until every checkpoint above is satisfied')
    }
  })

  test('adds a required checkpoint when quality council reviewers disagree', async () => {
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
        summary: 'Quality council reviewers disagreed about completion.',
        missingCriteria: ['Resolve reviewer disagreement about citation evidence.'],
        failureCategories: ['evidence_gap'],
        evidence: [{
          type: 'system',
          label: 'quality_council_disagreement',
          detail: 'acceptance_reviewer=pass; artifact_reviewer=fail; risk_reviewer=uncertain',
        }],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Required checkpoints:')
      expect(decision.prompt).toContain('Resolve the Quality Council reviewer disagreement')
      expect(decision.prompt).toContain('acceptance_reviewer=pass; artifact_reviewer=fail; risk_reviewer=uncertain')
    }
  })

  test('does not accept reviewer pass after verification gap without new tool evidence', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The final report includes verification results.',
        kind: 'test',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Previous pass had no verification output.',
        missingCriteria: ['Run verification and include the result.'],
        failureCategories: ['verification_gap'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish and verify the report'),
        message('a1', 'assistant', 'Report complete with verification summary.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('verification_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required verification evidence, but no successful tool evidence was produced in this turn.')
      expect(decision.prompt).toContain('Required checkpoints:')
    }
  })

  test('includes hard gate recovery guidance when a previous verification gap remains open', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The final report includes verification results.',
        kind: 'test',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Previous pass had no verification output.',
        missingCriteria: ['Run verification and include the result.'],
        failureCategories: ['verification_gap'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish and verify the report'),
        message('a1', 'assistant', 'Report complete with verification summary.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Hard gate recovery:')
      expect(decision.prompt).toContain('A previous verification gap is still open.')
      expect(decision.prompt).toContain('successful verification tool')
    }
  })

  test('does not accept reviewer pass after evidence gap without file or source evidence', async () => {
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
        summary: 'Previous pass lacked source evidence.',
        missingCriteria: ['Add source evidence.'],
        failureCategories: ['evidence_gap'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish the sourced report'),
        message('a1', 'assistant', 'Report complete with citations.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('evidence_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required file, source, or artifact evidence, but none was captured in this turn.')
      expect(decision.prompt).toContain('Required checkpoints:')
    }
  })

  test('does not accept reviewer pass after shallow output without substantive content', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The report provides a substantive implementation analysis.',
        kind: 'coverage',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Previous pass was only a brief outline.',
        missingCriteria: ['Expand the analysis with substantive content.'],
        failureCategories: ['shallow_output'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish the implementation analysis'),
        message('a1', 'assistant', 'Done.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('shallow_output')
      expect(decision.result.missingCriteria).toContain('Previous audit required substantive content, but this turn still produced a shallow deliverable.')
      expect(decision.prompt).toContain('Required checkpoints:')
    }
  })

  test('does not accept reviewer pass after scope gap when output still narrows scope', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The deliverable covers the full requested implementation plan.',
        kind: 'coverage',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Previous pass reduced the requested scope.',
        missingCriteria: ['Restore the full implementation scope.'],
        failureCategories: ['scope_gap'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish the full implementation plan'),
        message('a1', 'assistant', '先给你一个简版，后续可以继续完善。'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('scope_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required restoring full scope, but this turn still narrowed or deferred the requested deliverable.')
      expect(decision.prompt).toContain('Required checkpoints:')
    }
  })

  test('does not accept reviewer pass after tool failure without successful tool execution', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      iteration: 1,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The failed tool execution is resolved.',
        kind: 'test',
        required: true,
      }],
      auditHistory: [{
        iteration: 1,
        status: 'fail',
        summary: 'Previous pass had a failed command.',
        missingCriteria: ['Resolve the failed tool execution.'],
        failureCategories: ['tool_failure'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', 'finish after fixing the tool failure'),
        message('a1', 'assistant', 'The tool failure is fixed.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      reviewer: async () => ({
        status: 'pass',
        summary: 'Looks complete.',
        missingCriteria: [],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('tool_failure')
      expect(decision.result.missingCriteria).toContain('Previous audit required resolving a failed tool, but no successful tool execution was captured in this turn.')
      expect(decision.prompt).toContain('Required checkpoints:')
    }
  })

  test('escalates corrective prompts when the same failure category repeats', async () => {
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
        summary: 'Previous pass lacked source references.',
        missingCriteria: ['Need source references in appendix.'],
        failureCategories: ['evidence_gap'],
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
        summary: 'The report still lacks citation evidence.',
        missingCriteria: ['The final report cites the source spreadsheet.'],
        failureCategories: ['evidence_gap'],
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'system',
        label: 'repeated_failure_categories',
        detail: 'evidence_gap',
      }))
      expect(decision.prompt).toContain('Repeated failure pattern:')
      expect(decision.prompt).toContain('evidence_gap')
      expect(decision.prompt).toContain('Do not finish until the repeated failure categories are directly resolved')
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

  test('does not verify web URLs as local file paths', async () => {
    const controller = new GoalController()
    const verifiedPaths: string[] = []

    const decision = await controller.onTurnStopped(goal(), {
      messages: [
        message('u1', 'user', 'verify sources and write a summary'),
        message('t1', 'tool', 'Fetched https://www.example.com/report.html and //www.example.org/source.pdf', {
          toolName: 'WebFetch',
          toolStatus: 'completed',
          toolResult: 'Fetched https://www.example.com/report.html and //www.example.org/source.pdf',
        }),
        message('a1', 'assistant', 'Summary complete with cited web sources.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async (filePath) => {
        verifiedPaths.push(filePath)
        return { exists: false, readable: false }
      },
    })

    expect(verifiedPaths).toEqual([])
    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.missingCriteria).toEqual([])
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

  test('includes the task contract in automatic improvement prompts', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成完整项目分析报告，必须包含风险清单。',
        taskType: 'document',
        deliverables: ['Produce a structured, readable work product.'],
        mustPreserve: ['Explicit requirement: 风险清单'],
        evidenceRequirements: ['Ground key facts in source material.'],
        outputFormats: ['MD'],
        acceptanceCriteria: ['[user_constraint] Must satisfy explicit user requirement: 风险清单.'],
        forbiddenShortcuts: ['Do not silently simplify, summarize away, or omit explicit user requirements.'],
        workingDirectory: '/tmp/project-a',
      },
      criteria: [{
        id: 'crit-user-requirement',
        text: 'Must satisfy explicit user requirement: 风险清单.',
        kind: 'user_constraint',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请生成完整项目分析报告，必须包含风险清单。'),
        message('a1', 'assistant', '项目分析报告已完成。'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Task contract:')
      expect(decision.prompt).toContain('Explicit requirement: 风险清单')
      expect(decision.prompt).toContain('/tmp/project-a')
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'system',
        label: 'task_contract',
      }))
    }
  })

  test('does not accept obvious scope reduction against the task contract', async () => {
    const controller = new GoalController()
    const reviewPrompts: string[] = []

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请全面生成正式报告。',
        taskType: 'document',
        deliverables: ['Produce a structured, readable work product.'],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: ['Do not replace the requested work product with a high-level outline.'],
      },
    }), {
      messages: [
        message('u1', 'user', '请全面生成正式报告。'),
        message('a1', 'assistant', '由于篇幅有限，这里先给一个框架，后续可以补充完善。'),
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
      expect(decision.result.missingCriteria).toContain('Task contract appears to have been reduced to a summary, outline, placeholder, or deferred follow-up instead of the requested deliverable.')
      expect(decision.result.evidence).toContainEqual({
        type: 'message',
        label: 'task_contract_scope_reduced',
        detail: 'a1',
      })
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

  test('auto-continues after code verification diagnostics fail', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      objective: 'Fix the upload button bug and verify typecheck.',
      maxIterations: 3,
      taskContract: {
        originalRequest: 'Fix the upload button bug and verify typecheck.',
        taskType: 'code',
        deliverables: ['Minimal code fix with verification'],
        mustPreserve: [],
        evidenceRequirements: ['Inspect implementation and verify the change.'],
        outputFormats: [],
        acceptanceCriteria: ['[test] Run the requested verification command.'],
        forbiddenShortcuts: ['Do not refactor unrelated code.'],
      },
      criteria: [{
        id: 'crit-verify',
        text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
        kind: 'test',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'fix upload button and run typecheck'),
        message('t1', 'tool', 'typecheck failed', {
          toolName: 'typecheck',
          toolStatus: 'error',
          toolResult: 'src/upload.ts(42,7): error TS2322: Type string is not assignable to type File.',
        }),
        message('a1', 'assistant', 'I changed the upload button but typecheck still fails.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('verification_gap')
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'tool',
        label: 'code_verification_diagnostics',
      }))
      expect(decision.prompt).toContain('Fix the reported code diagnostics')
      expect(decision.prompt).toContain('TS2322')
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

  test('adds context pressure evidence and checkpoint when an auto-improve turn needs another pass', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-source-citation',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a cited report'),
        message('a1', 'assistant', 'Report draft complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
      contextPressure: {
        enabledSourceCount: 12,
        contextWindow: 64_000,
        inputTokens: 8_000,
      },
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.evidence).toContainEqual({
        type: 'system',
        label: 'context_pressure_warning',
        detail: '12 sources · ~18k source/tool tokens · 13% context used',
      })
      expect(decision.prompt).toContain('Reduce context/tool pressure by narrowing enabled sources')
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
