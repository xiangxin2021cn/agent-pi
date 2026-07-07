import { describe, expect, test } from 'bun:test'
import type { Message } from '@craft-agent/core/types'
import type { SessionGoalState } from '@craft-agent/shared/sessions'
import { GoalController } from './goal-controller'
import { COMPREHENSIVE_QUALITY_CRITERION_TEXT, DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT, FILE_OUTPUT_REQUIRED_CRITERION_TEXT, TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT, TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT, VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT } from './goal-criteria'

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

  test('needs review instead of auto-improving when the assistant asks for user confirmation', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      criteria: [{
        id: 'crit-1',
        text: 'Analyze the selected COTO knowledge base source.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请分析第一册 COTO 规范。'),
        message('a1', 'assistant', [
          '在实际执行前，我需要确认您的具体需求：',
          '1. 目标范围：是所有章节还是本项目关键条款？',
          '2. 输出格式：独立详解文件还是汇总文件？',
          '请对以上问题给出指引，我会据此制定执行计划。',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.result.status).toBe('uncertain')
      expect(decision.result.missingCriteria).toContain('Assistant requested user confirmation before continuing.')
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'message',
        label: 'human_input_requested',
      }))
      expect(decision.reason).toContain('user confirmation')
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

  test('does not accept professional document output that ignores the evidence matrix', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成专业文档模式的投标分析报告，必须基于证据矩阵写作。',
        taskType: 'document',
        documentQualityMode: 'professional_document',
        documentPlan: {
          sections: ['Executive Summary', 'Tender Requirements', 'Risk Review'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['MD'],
          evidenceMatrix: [{
            id: 'evidence-source-1',
            source: 'tender-requirements.pdf',
            sourceType: 'file',
            supports: 'Tender requirements and risk constraints.',
            reliabilityNote: 'User-provided tender document; cite page or clause before treating as verified.',
            citationFields: ['source', 'locator', 'claim'],
            reuseStatus: 'candidate',
          }],
        },
        deliverables: ['Produce a source-backed tender analysis report.'],
        mustPreserve: [],
        evidenceRequirements: ['Use the evidence matrix for source-backed claims.'],
        outputFormats: ['MD'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '请生成专业文档模式的投标分析报告，必须基于证据矩阵写作。'),
        message('a1', 'assistant', [
          '# Executive Summary',
          '',
          'The tender is attractive and the project team should proceed with a focused delivery strategy.',
          '',
          '# Tender Requirements',
          '',
          'The requirements are clear, commercially manageable, and technically achievable with a standard execution plan.',
          '',
          '# Risk Review',
          '',
          'The main risks are schedule pressure, supplier coordination, and incomplete design inputs. The recommended mitigation is tighter governance and early procurement planning.',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Evidence matrix audit did not pass: Missing reference to evidence matrix sources, citations, or pending evidence gaps.')
      expect(decision.result.failureCategories).toContain('evidence_gap')
      expect(decision.prompt).toContain('Locate the source, artifact, or file evidence before finalizing')
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'evidence_matrix_audit'
        && (item.detail ?? '').includes('evidence-source-1')
      )).toBe(true)
    }
  })

  test('does not treat a source filename list as evidence matrix citation coverage', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成专业文档模式的投标分析报告，必须基于证据矩阵写作并引用具体出处。',
        taskType: 'document',
        documentQualityMode: 'professional_document',
        documentPlan: {
          sections: ['Executive Summary', 'Tender Requirements', 'Risk Review', 'Actions'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['MD'],
          evidenceMatrix: [{
            id: 'evidence-source-1',
            source: 'tender-requirements.pdf',
            sourceType: 'file',
            supports: 'Tender requirements and risk constraints.',
            reliabilityNote: 'User-provided tender document; cite page or clause before treating as verified.',
            citationFields: ['source', 'locator', 'claim'],
            reuseStatus: 'candidate',
          }],
        },
        deliverables: ['Produce a source-backed tender analysis report.'],
        mustPreserve: [],
        evidenceRequirements: ['Use the evidence matrix for source-backed claims with source, locator, and claim fields.'],
        outputFormats: ['MD'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '请生成专业文档模式的投标分析报告，必须基于证据矩阵写作并引用具体出处。'),
        message('a1', 'assistant', [
          '# Executive Summary',
          '',
          'The tender appears commercially workable and technically executable if the project team preserves a controlled submission baseline. The recommended approach is to keep technical compliance, pricing exposure, and schedule interfaces under one review cadence before final submission.',
          '',
          '# Tender Requirements',
          '',
          'The requirements indicate a formal delivery process with scope, risk, and compliance obligations. The team should treat design interfaces, programme interfaces, and commercial exclusions as controlled items before submitting the final document.',
          '',
          '# Risk Review',
          '',
          '| Risk | Impact | Control |',
          '| --- | --- | --- |',
          '| Ambiguous scope boundary | May lead to pricing omissions | Maintain a scope clarification register |',
          '| Late file review | May weaken evidence-backed claims | Schedule an internal file review before final delivery |',
          '| Schedule compression | May reduce review quality | Use a staged review before final delivery |',
          '',
          '# Actions',
          '',
          'The next action is to reconcile the report against the tender requirements, update the risk register, and prepare the final submission narrative.',
          '',
          '# Input Materials',
          '',
          '- tender-requirements.pdf',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Evidence matrix audit did not pass: Missing claim-level evidence matrix citation with source, locator, or claim fields.')
    }
  })

  test('requires every evidence matrix source to be cited or marked pending', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成专业文档模式的投标分析报告，必须覆盖证据矩阵中的每个来源。',
        taskType: 'document',
        documentQualityMode: 'professional_document',
        documentPlan: {
          sections: ['Executive Summary', 'Tender Requirements', 'Cost Review', 'Actions'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['MD'],
          evidenceMatrix: [{
            id: 'evidence-source-1',
            source: 'tender-requirements.pdf',
            sourceType: 'file',
            supports: 'Tender requirements and risk constraints.',
            reliabilityNote: 'User-provided tender document; cite page or clause before treating as verified.',
            citationFields: ['source', 'locator', 'claim'],
            reuseStatus: 'candidate',
          }, {
            id: 'evidence-source-2',
            source: 'cost-database.xlsx',
            sourceType: 'file',
            supports: 'Cost rates and pricing assumptions.',
            reliabilityNote: 'User-provided cost workbook; cite worksheet or row before treating as verified.',
            citationFields: ['source', 'locator', 'claim'],
            reuseStatus: 'candidate',
          }],
        },
        deliverables: ['Produce a source-backed tender analysis report.'],
        mustPreserve: [],
        evidenceRequirements: ['Use every evidence matrix source or mark the source-specific evidence gap.'],
        outputFormats: ['MD'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '请生成专业文档模式的投标分析报告，必须覆盖证据矩阵中的每个来源。'),
        message('a1', 'assistant', [
          '# Executive Summary',
          '',
          'The tender appears commercially workable and technically executable if the project team preserves a controlled submission baseline. The recommended approach is to keep technical compliance, pricing exposure, and schedule interfaces under one review cadence before final submission.',
          '',
          '# Tender Requirements',
          '',
          'Source: tender-requirements.pdf; Locator: p. 4; Claim: the submission must preserve formal compliance controls before final delivery.',
          '',
          '# Cost Review',
          '',
          'The cost review concludes that the pricing basis is manageable if the commercial team validates resource rates and escalation exposure before final submission.',
          '',
          '# Actions',
          '',
          'The next action is to reconcile the report against the tender requirements, update the risk register, and prepare the final submission narrative.',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Evidence matrix audit did not pass: Missing evidence matrix coverage for sources: cost-database.xlsx.')
    }
  })

  test('does not accept pure prose for a visual-heavy professional document task', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成专业施工进度报告，必须包含WBS、基线/当前计划、关键路径、里程碑和A3横向甘特图。',
        taskType: 'document',
        documentPlan: {
          domain: 'construction',
          visualPlan: {
            mode: 'professional',
            selectedKinds: ['construction-gantt'],
            opportunities: [],
            auditRequirements: ['Every professional visual must have verified data, a caption, a source note, and an audit reason.'],
          },
          sections: ['Schedule basis', 'Construction Gantt'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['MD'],
        },
        deliverables: ['Produce a professional construction schedule report.'],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['MD'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
      criteria: [{
        id: 'crit-visual',
        text: VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请生成专业施工进度报告，必须包含WBS、基线/当前计划、关键路径、里程碑和A3横向甘特图。'),
        message('a1', 'assistant', '施工进度报告已经完成。项目按WBS分为道路、桥涵、排水三个部分，后续会补充甘特图。'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria.some(item => item.includes('Visual block audit did not pass'))).toBe(true)
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'visual_block_audit'
        && (item.detail ?? '').includes('construction-gantt')
      )).toBe(true)
    }
  })

  test('does not accept construction gantt visual without requested A3 landscape page intent', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请生成专业施工进度报告，必须包含A3横向甘特图。',
        taskType: 'document',
        documentPlan: {
          domain: 'construction',
          visualPlan: {
            mode: 'professional',
            selectedKinds: ['construction-gantt'],
            opportunities: [],
            auditRequirements: [
              'Every professional visual must have verified data, a caption, a source note, and an audit reason.',
              'Construction Gantt visuals requested as A3 landscape must preserve A3 landscape page intent in the rendered asset or caption metadata.',
            ],
          },
          sections: ['Schedule basis', 'Construction Gantt'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['MD'],
        },
        deliverables: ['Produce a professional construction schedule report with A3 landscape Gantt.'],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['MD'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
      criteria: [{
        id: 'crit-visual',
        text: VISUAL_BLOCK_AUDIT_REQUIRED_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请生成专业施工进度报告，必须包含A3横向甘特图。'),
        message('a1', 'assistant', [
          '# Schedule basis',
          '',
          'The schedule is organized by WBS, baseline, current dates, critical path, and milestones.',
          '',
          '![Figure 1. Professional construction Gantt](schedule.svg)',
          '',
          'Figure 1. Professional construction Gantt. Source: verified project schedule. Audit reason: WBS, critical path, and milestones are easier to review visually.',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria.some(item => item.includes('A3 landscape'))).toBe(true)
    }
  })

  test('does not accept prompt-only compliance for strict template fidelity', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请严格按照上传的Word模板版式、目录层级、字体和页面布局生成新的报告。',
        taskType: 'document',
        documentPlan: {
          templateProfileId: 'pending-template-profile',
          strictTemplate: true,
          sections: ['Executive Summary', 'Project Scope'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['DOCX'],
        },
        deliverables: ['Produce a strict-template DOCX report.'],
        mustPreserve: [],
        evidenceRequirements: [],
        outputFormats: ['DOCX'],
        acceptanceCriteria: [],
        forbiddenShortcuts: ['Do not claim template fidelity from prompt wording alone.'],
      },
      criteria: [{
        id: 'crit-template',
        text: TEMPLATE_FIDELITY_REQUIRED_CRITERION_TEXT,
        kind: 'coverage',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '请严格按照上传的Word模板版式、目录层级、字体和页面布局生成新的报告。'),
        message('a1', 'assistant', '# Executive Summary\n\nThe report follows the template.\n\n# Project Scope\n\nThe scope is complete.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria.some(item => item.includes('Template fidelity audit did not pass'))).toBe(true)
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'template_fidelity_audit'
        && (item.detail ?? '').includes('Strict DOCX template audit requires exported DOCX structure evidence')
      )).toBe(true)
    }
  })

  test('enforces strict delivery contract gates even when criteria omit explicit audit items', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '严格交付一份带模板、图表、PDF和DOCX导出的正式报告。',
        taskType: 'document',
        documentQualityMode: 'strict_delivery',
        documentPlan: {
          templateProfileId: 'uploaded-template-profile',
          strictTemplate: true,
          visualPlan: {
            mode: 'professional',
            selectedKinds: ['construction-gantt'],
            opportunities: [],
            auditRequirements: [],
          },
          sections: ['Executive Summary', 'Schedule'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: ['PDF', 'DOCX'],
          deliveryReviewPlan: {
            mode: 'strict_delivery',
            failureAction: 'needs_review_or_auto_improve',
            gates: [{
              id: 'export_files',
              requirement: 'Every requested delivery format must be produced as a verifiable output file.',
              evidence: 'Verified output files for PDF, DOCX.',
            }],
          },
        },
        deliverables: ['Produce a strict-delivery professional report.'],
        mustPreserve: [],
        evidenceRequirements: ['Pass source, template, export, visual, and format gates.'],
        outputFormats: ['PDF', 'DOCX'],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '严格交付一份带模板、图表、PDF和DOCX导出的正式报告。'),
        message('t1', 'tool', 'created markdown draft', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '/tmp/final-report.md' },
        }),
        message('a1', 'assistant', '已完成正式报告草稿：/tmp/final-report.md'),
      ],
      stoppedReason: 'complete',
      now: 10,
      fileVerifier: async () => ({
        exists: true,
        readable: true,
        isFile: true,
        sizeBytes: 180,
        preview: '# Executive Summary\n\nThe report is complete.\n\n# Schedule\n\nThe construction schedule is summarized in prose.',
      }),
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.missingCriteria).toContain('Requested output format was not produced: PDF.')
      expect(decision.result.missingCriteria).toContain('Requested output format was not produced: DOCX.')
      expect(decision.result.missingCriteria.some(item => item.includes('Template fidelity audit did not pass'))).toBe(true)
      expect(decision.result.missingCriteria.some(item => item.includes('Visual block audit did not pass'))).toBe(true)
      expect(decision.result.missingCriteria).toContain('Strict delivery gate failed: export_files - Every requested delivery format must be produced as a verifiable output file.')
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'delivery_review_gate'
        && (item.detail ?? '').includes('export_files')
      )).toBe(true)
    }
  })

  test('fails strict delivery source gate when output has no source or pending-evidence marker', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '严格交付一份可审计的正式研究报告。',
        taskType: 'document',
        documentQualityMode: 'strict_delivery',
        documentPlan: {
          sections: ['Executive Summary', 'Findings'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: [],
          deliveryReviewPlan: {
            mode: 'strict_delivery',
            failureAction: 'needs_review_or_auto_improve',
            gates: [{
              id: 'source_integrity',
              requirement: 'Source-backed claims, tables, and visuals must cite evidence or mark unavailable evidence as pending.',
              evidence: 'Evidence matrix entries with locators, excerpts, values, or unresolved-gap notes.',
            }],
          },
        },
        deliverables: ['Produce an auditable formal report.'],
        mustPreserve: [],
        evidenceRequirements: ['Pass source integrity before claiming completion.'],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '严格交付一份可审计的正式研究报告。'),
        message('a1', 'assistant', [
          '# Executive Summary',
          '',
          'The market is attractive and the project should proceed.',
          '',
          '# Findings',
          '',
          'The report recommends immediate execution because all indicators are favorable.',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Strict delivery gate failed: source_integrity - Source-backed claims, tables, and visuals must cite evidence or mark unavailable evidence as pending.')
      expect(decision.prompt).toContain('source_integrity')
      expect(decision.prompt).toContain('Source-backed claims, tables, and visuals must cite evidence')
      expect(decision.prompt).toContain('Resolve each failed strict delivery gate before claiming the formal document is complete')
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'delivery_review_gate'
        && (item.detail ?? '').includes('Source integrity gate did not find citations')
      )).toBe(true)
    }
  })

  test('fails strict delivery format gate when no format review evidence is documented', async () => {
    const controller = new GoalController()
    const content = [
      '# Executive Summary',
      '',
      'This formal delivery report provides a structured summary of the project scope, commercial exposure, and implementation controls. The document is written as a complete artifact rather than a note. It describes the execution basis, records assumptions, and sets out the actions needed before final submission.',
      '',
      '# Delivery Basis',
      '',
      'The work package includes document preparation, source-backed analysis, risk review, and final submission packaging. The delivery team should keep the report structure stable, preserve the requested section order, and avoid replacing the formal deliverable with a short summary. The current narrative includes specific project controls, responsibility boundaries, and review expectations.',
      '',
      '# Risk Review',
      '',
      '| Risk | Impact | Control |',
      '| --- | --- | --- |',
      '| Schedule compression | May reduce review time and increase rework | Preserve review checkpoints before release |',
      '| Incomplete source records | May weaken claims and figures | Keep source gaps visible until confirmed |',
      '| Export mismatch | May produce a file that differs from the reviewed Markdown | Compare the final visible structure before acceptance |',
      '',
      '# Delivery Actions',
      '',
      'The final submission should retain the headings, table structure, and source-gap notes. Any missing evidence should be marked before acceptance. The report should not be treated as finished until all strict delivery gates have explicit evidence in the artifact or in verified output inspection records.',
    ].join('\n')

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '严格交付一份正式报告，必须通过最终格式审查。',
        taskType: 'document',
        documentQualityMode: 'strict_delivery',
        documentPlan: {
          sections: ['Executive Summary', 'Delivery Basis', 'Risk Review', 'Delivery Actions'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: [],
          deliveryReviewPlan: {
            mode: 'strict_delivery',
            failureAction: 'needs_review_or_auto_improve',
            gates: [{
              id: 'format_review',
              requirement: 'Final artifact structure, headings, tables, captions, and visible formatting must be reviewed before completion.',
              evidence: 'Rendered preview, exported file inspection, or documented manual review findings.',
            }],
          },
        },
        deliverables: ['Produce a strict-delivery report with format review evidence.'],
        mustPreserve: [],
        evidenceRequirements: ['Pass final formatting review before claiming completion.'],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '严格交付一份正式报告，必须通过最终格式审查。'),
        message('a1', 'assistant', content),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Strict delivery gate failed: format_review - Final artifact structure, headings, tables, captions, and visible formatting must be reviewed before completion.')
      expect(decision.prompt).toContain('format_review')
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'delivery_review_gate'
        && (item.detail ?? '').includes('Format review gate did not find rendered preview, exported inspection, or documented format review evidence')
      )).toBe(true)
    }
  })

  test('does not treat a deferred visible formatting note as strict delivery format review evidence', async () => {
    const controller = new GoalController()
    const content = [
      '# Executive Summary',
      '',
      'This formal delivery report gives a complete summary of project scope, commercial exposure, implementation controls, and final submission responsibilities. It is written as a complete artifact with stable headings, a risk table, and action records rather than as an outline or a short note.',
      '',
      '# Delivery Basis',
      '',
      'The work package includes document preparation, source-backed analysis, risk review, and final submission packaging. The team should preserve the requested section order, retain the formal report structure, and keep unresolved evidence visible until confirmed.',
      '',
      '# Risk Review',
      '',
      '| Risk | Impact | Control |',
      '| --- | --- | --- |',
      '| Schedule compression | May reduce review time and increase rework | Preserve review checkpoints before release |',
      '| Export mismatch | May produce a file that differs from the reviewed Markdown | Compare the final visible formatting before acceptance |',
      '',
      '# Delivery Actions',
      '',
      'The visible formatting must be reviewed before completion, but this draft has not yet recorded a rendered preview, exported-file inspection, or manual review finding.',
    ].join('\n')

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '严格交付一份正式报告，必须通过最终格式审查。不能只说以后要审查。',
        taskType: 'document',
        documentQualityMode: 'strict_delivery',
        documentPlan: {
          sections: ['Executive Summary', 'Delivery Basis', 'Risk Review', 'Delivery Actions'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: [],
          deliveryReviewPlan: {
            mode: 'strict_delivery',
            failureAction: 'needs_review_or_auto_improve',
            gates: [{
              id: 'format_review',
              requirement: 'Final artifact structure, headings, tables, captions, and visible formatting must be reviewed before completion.',
              evidence: 'Rendered preview, exported file inspection, or documented manual review findings.',
            }],
          },
        },
        deliverables: ['Produce a strict-delivery report with completed format review evidence.'],
        mustPreserve: [],
        evidenceRequirements: ['Pass final formatting review before claiming completion.'],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: [],
      },
    }), {
      messages: [
        message('u1', 'user', '严格交付一份正式报告，必须通过最终格式审查。不能只说以后要审查。'),
        message('a1', 'assistant', content),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria).toContain('Strict delivery gate failed: format_review - Final artifact structure, headings, tables, captions, and visible formatting must be reviewed before completion.')
    }
  })

  test('does not accept multi-agent deep output without chapter handoff and final synthesis evidence', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请用多智能体深度模式生成大型投标报告，分章节完成并做总编合成。',
        taskType: 'document',
        documentQualityMode: 'multi_agent_deep',
        documentPlan: {
          sections: ['技术方案', '施工进度'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: [],
          agentPlan: {
            mode: 'chapter_agents',
            finalSynthesisOwner: 'final_synthesis_owner',
            assignments: [{
              id: 'chapter-agent-1',
              title: '技术方案',
              role: 'technical_chapter_agent',
              reviewFocus: 'technical completeness and source-backed constraints',
            }, {
              id: 'chapter-agent-2',
              title: '施工进度',
              role: 'schedule_chapter_agent',
              reviewFocus: 'schedule logic and milestone consistency',
            }],
            reviewStages: [
              'Chapter evidence review before synthesis.',
              'Cross-chapter consistency review before final synthesis.',
            ],
            guardrails: [
              'Each chapter agent must list source gaps and unresolved assumptions before handoff.',
              'Only the final synthesis owner may write or replace the final deliverable after chapter drafts are reviewed.',
            ],
          },
        },
        deliverables: ['Produce a large tender report with chapter-agent handoffs and final synthesis.'],
        mustPreserve: [],
        evidenceRequirements: ['Use chapter-level or discipline-level evidence coverage and resolve cross-chapter inconsistencies before final synthesis.'],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: ['Do not let multiple agents write the same final artifact concurrently; use one final synthesis owner.'],
      },
    }), {
      messages: [
        message('u1', 'user', '请用多智能体深度模式生成大型投标报告，分章节完成并做总编合成。'),
        message('a1', 'assistant', [
          '# 技术方案',
          '',
          '施工组织设计已完成，主要施工方法清晰。',
          '',
          '# 施工进度',
          '',
          '总体进度计划已完成，关键节点可以满足投标要求。',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria.some(item => item.includes('Multi-agent deep audit did not pass'))).toBe(true)
      expect(decision.prompt).toContain('chapter-agent handoff')
      expect(decision.prompt).toContain('final_synthesis_owner')
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'document_agent_plan_audit'
        && (item.detail ?? '').includes('missingFinalSynthesisOwner: yes')
      )).toBe(true)
    }
  })

  test('does not accept multi-agent deep output that only claims handoffs without real spawned sessions', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      taskContract: {
        originalRequest: '请用多智能体深度模式生成施工策划报告。',
        taskType: 'document',
        documentQualityMode: 'multi_agent_deep',
        documentPlan: {
          sections: ['技术方案'],
          tables: [],
          charts: [],
          enhancements: [],
          citations: [],
          deliveryFormats: [],
          agentPlan: {
            mode: 'chapter_agents',
            finalSynthesisOwner: 'final_synthesis_owner',
            assignments: [{
              id: 'chapter-agent-1',
              title: '技术方案',
              role: 'technical_chapter_agent',
              reviewFocus: 'technical completeness and source-backed constraints',
            }],
            reviewStages: ['Cross-chapter consistency review before final synthesis.'],
            guardrails: ['Each chapter agent must list source gaps and unresolved assumptions before handoff.'],
          },
        },
        deliverables: ['Produce a report with a real chapter-agent handoff.'],
        mustPreserve: [],
        evidenceRequirements: ['Use selected knowledge-base evidence.'],
        outputFormats: [],
        acceptanceCriteria: [],
        forbiddenShortcuts: ['Do not fake multi-agent handoff notes in the final artifact.'],
      },
    }), {
      messages: [
        message('u1', 'user', '请用多智能体深度模式生成施工策划报告。'),
        message('a1', 'assistant', [
          '# 施工策划报告',
          '',
          'chapter-agent-1 技术方案 handoff: source gaps none; unresolved assumptions none.',
          '',
          'Cross-chapter consistency review complete.',
          '',
          'final_synthesis_owner 完成最终合成。',
        ].join('\n')),
      ],
      stoppedReason: 'complete',
      now: 10,
      spawnedSessions: [],
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.missingCriteria.some(item => item.includes('real spawned chapter sessions'))).toBe(true)
      expect(decision.result.evidence.some(item =>
        item.type === 'system'
        && item.label === 'document_agent_plan_audit'
        && (item.detail ?? '').includes('missingRealSpawnedSessions: yes')
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('verification_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required verification evidence, but no successful tool evidence was produced in this turn.')
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
    }
  })

  test('records hard gate recovery evidence when a previous verification gap remains open on the final automatic pass', async () => {
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'tool',
        label: 'previous_verification_checkpoint_missing',
      }))
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('evidence_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required file, source, or artifact evidence, but none was captured in this turn.')
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('shallow_output')
      expect(decision.result.missingCriteria).toContain('Previous audit required substantive content, but this turn still produced a shallow deliverable.')
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('scope_gap')
      expect(decision.result.missingCriteria).toContain('Previous audit required restoring full scope, but this turn still narrowed or deferred the requested deliverable.')
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('tool_failure')
      expect(decision.result.missingCriteria).toContain('Previous audit required resolving a failed tool, but no successful tool execution was captured in this turn.')
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
    }
  })

  test('records repeated failure categories before stopping for user review on the final automatic pass', async () => {
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

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'system',
        label: 'repeated_failure_categories',
        detail: 'evidence_gap',
      }))
      expect(decision.result.correctivePrompt).toBeUndefined()
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
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

  test('ignores transient session data helper files when checking requested outputs', async () => {
    const controller = new GoalController()
    const verifiedPaths: string[] = []
    const outputPath = 'E:\\南非项目\\投标项目\\South Africa\\ROUTE 3 SECTION 1\\Agent Pi Outputs\\260703-gentle-glacier\\C5.2_Resource_Detail.xlsx'

    const decision = await controller.onTurnStopped(goal({
      mode: 'check_only',
      criteria: [{
        id: 'crit-file-output',
        text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
        kind: 'deliverable',
        required: true,
      }, {
        id: 'crit-output-format',
        text: 'Create output file(s) in the requested format(s): XLSX.',
        kind: 'format',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成 5.2 人材机明细表 xlsx'),
        message('t1', 'tool', 'created helper', {
          toolName: 'Write',
          toolStatus: 'completed',
          toolInput: { file_path: '{{SESSION_PATH}}\\data\\gen_detail_excel.py' },
        }),
        message('t1b', 'tool', 'Found 2 occurrences of edits[2] in {{SESSION_PATH}}\\data\\gen_detail_excel.py. Each oldText must be unique.', {
          toolName: 'Edit',
          toolStatus: 'error',
          isError: true,
          toolInput: { file_path: '{{SESSION_PATH}}\\data\\gen_detail_excel.py' },
          toolResult: 'Found 2 occurrences of edits[2] in {{SESSION_PATH}}\\data\\gen_detail_excel.py. Each oldText must be unique.',
        }),
        message('t2', 'tool', `OK: ${outputPath}\nRows: 111\nSheets: Resource Detail, Resource Summary, Productivity`, {
          toolName: 'Bash',
          toolStatus: 'completed',
          toolResult: `OK: ${outputPath}\nRows: 111\nSheets: Resource Detail, Resource Summary, Productivity`,
        }),
        message('t3', 'tool', 'cleaned', {
          toolName: 'Bash',
          toolStatus: 'completed',
          toolInput: { command: 'rm -f "{{SESSION_PATH}}\\data\\gen_detail_excel.py"' },
          toolResult: 'cleaned',
        }),
        message('a1', 'assistant', `已生成：${outputPath}`),
      ],
      stoppedReason: 'complete',
      now: 10,
      expectedOutputDirectory: 'E:\\南非项目\\投标项目\\South Africa\\ROUTE 3 SECTION 1\\Agent Pi Outputs\\260703-gentle-glacier',
      fileVerifier: async (filePath) => {
        verifiedPaths.push(filePath)
        return filePath === outputPath
          ? { exists: true, readable: true, isFile: true, sizeBytes: 18573 }
          : { exists: false, readable: false }
      },
      reviewer: async () => ({
        status: 'pass',
        summary: 'The requested XLSX output is complete.',
        missingCriteria: [],
      }),
    })

    expect(verifiedPaths).toEqual([outputPath])
    expect(decision.action).toBe('complete')
    if (decision.action === 'complete') {
      expect(decision.result.missingCriteria).not.toContain('Requested output format was not produced: XLSX.')
      expect(decision.result.missingCriteria.some(criterion => criterion.includes('{{SESSION_PATH}}\\data\\gen_detail_excel.py'))).toBe(false)
      expect(decision.result.evidence.some(item => item.detail?.includes('{{SESSION_PATH}}\\data\\gen_detail_excel.py'))).toBe(false)
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
      iteration: 0,
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
      auditHistory: [{
        iteration: 0,
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
      expect(decision.prompt).toContain('Iteration 0: fail - The executive summary was still missing.')
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

  test('puts instruction-following before quality in automatic improvement prompts', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      maxIterations: 2,
      objective: '只分析选中的 COTO Chapter 1 知识库。',
      taskContract: {
        originalRequest: '只分析我选中的 COTO Chapter 1 知识库，输出中文分析。',
        taskType: 'document',
        documentQualityMode: 'multi_agent_deep',
        deliverables: ['Produce a focused Chapter 1 analysis.'],
        mustPreserve: [
          'Explicit scope: selected COTO Chapter 1 only.',
          'Language: Chinese.',
        ],
        evidenceRequirements: ['Use the selected Chapter 1 knowledge base source.'],
        outputFormats: ['MD'],
        acceptanceCriteria: ['[user_constraint] Analyze only selected Chapter 1.'],
        forbiddenShortcuts: ['Do not broaden the task to all COTO chapters.'],
      },
      criteria: [{
        id: 'crit-1',
        text: 'Analyze only selected Chapter 1.',
        kind: 'user_constraint',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '只分析我选中的 COTO Chapter 1 知识库，输出中文分析。'),
        message('a1', 'assistant', 'I created a complete COTO all-chapter synthesis in English and Chinese.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.prompt).toContain('Instruction-following gate')
      expect(decision.prompt).toContain('Original user request:')
      expect(decision.prompt).toContain('只分析我选中的 COTO Chapter 1 知识库')
      expect(decision.prompt).toContain('Do not broaden the scope beyond the original request or follow-up instructions.')
      expect(decision.prompt).toContain('Only after the instruction-following gate passes')
    }
  })

  test('stops for user review after the second automatic improvement pass even when older goals allow more iterations', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      maxIterations: 4,
      iteration: 1,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the selected knowledge base source.',
        kind: 'evidence',
        required: true,
      }],
      auditHistory: [{
        iteration: 0,
        status: 'fail',
        summary: 'First pass did not cite the selected source.',
        missingCriteria: ['The final report cites the selected knowledge base source.'],
        failureCategories: ['evidence_gap'],
        evidence: [],
        createdAt: 5,
      }],
    }), {
      messages: [
        message('u1', 'user', '只分析选中的 Chapter 1 知识库。'),
        message('a1', 'assistant', 'Second attempt still has no selected knowledge-base citation.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('needs_review')
    if (decision.action === 'needs_review') {
      expect(decision.goalState.status).toBe('needs_review')
      expect(decision.goalState.iteration).toBe(2)
      expect(decision.reason).toBe('Reached maximum automatic repair passes (2); manual review is required.')
      expect(decision.result.correctivePrompt).toBeUndefined()
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
      expect(decision.reason).toContain('maximum automatic repair passes')
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

  test('does not auto-continue when the turn produced a system error message', async () => {
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
        message('e1', 'error', 'Authentication failed. Please check your credentials.'),
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

  test('continues automatically after a recoverable tool failure reports missing work', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      maxIterations: 3,
      criteria: [{
        id: 'crit-1',
        text: 'The final report cites the source spreadsheet.',
        kind: 'evidence',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', 'write a report using source.xlsx'),
        message('t1', 'tool', 'failed', {
          toolStatus: 'error',
          toolName: 'Read',
          toolResult: 'ENOENT: source.xlsx was not found in the current directory',
        }),
        message('a1', 'assistant', 'I could not finish the cited report because source.xlsx was not found.'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.status).toBe('fail')
      expect(decision.result.failureCategories).toContain('tool_failure')
      expect(decision.prompt).toContain('Resolve the failed tool')
      expect(decision.prompt).toContain('source.xlsx')
    }
  })

  test('uses transactional artifact recovery after long document write failure', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      maxIterations: 3,
      taskContract: {
        originalRequest: '生成完整长篇施工组织设计 Markdown 文件。',
        taskType: 'document',
        documentQualityMode: 'professional_document',
        deliverables: ['Produce a complete long Markdown deliverable.'],
        mustPreserve: ['Original requested scope and section plan.'],
        evidenceRequirements: ['Verify final artifact path and section completeness.'],
        outputFormats: ['MD'],
        acceptanceCriteria: ['[deliverable] Long document artifact is complete.'],
        forbiddenShortcuts: ['Do not restart the entire document after one section write fails.'],
      },
      criteria: [{
        id: 'crit-1',
        text: 'Long document artifact is complete.',
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成完整长篇施工组织设计 Markdown 文件。'),
        message('t1', 'tool', 'write failed', {
          toolStatus: 'error',
          toolName: 'Write',
          toolInput: { file_path: '/tmp/output/stage2_c12_env_safety.md' },
          toolResult: 'content exceeds tool input limit after about 7KB',
        }),
        message('a1', 'assistant', '文件被 Write 工具截断了，我将重新构建完整增强文件。'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.failureCategories).toContain('tool_failure')
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'tool',
        label: 'artifact_write_failure',
      }))
      expect(decision.prompt).toContain('Resume from the artifact manifest and completed section chunks')
      expect(decision.prompt).toContain('Do not restart or rewrite the whole long document')
      expect(decision.prompt).toContain('retry only the failed section chunk')
      expect(decision.prompt).toContain('verify the final artifact path, section count, required headings, and non-empty content')
    }
  })

  test('requires an explicit target path after long document write validation fails', async () => {
    const controller = new GoalController()

    const decision = await controller.onTurnStopped(goal({
      mode: 'auto_improve',
      maxIterations: 3,
      taskContract: {
        originalRequest: '生成完整长篇施工组织设计 Markdown 文件。',
        taskType: 'document',
        documentQualityMode: 'professional_document',
        deliverables: ['Produce a complete long Markdown deliverable.'],
        mustPreserve: ['Original requested scope and section plan.'],
        evidenceRequirements: ['Verify final artifact path and section completeness.'],
        outputFormats: ['MD'],
        acceptanceCriteria: ['[deliverable] Long document artifact is complete.'],
        forbiddenShortcuts: ['Do not resend document content without a target path.'],
      },
      criteria: [{
        id: 'crit-1',
        text: 'Long document artifact is complete.',
        kind: 'deliverable',
        required: true,
      }],
    }), {
      messages: [
        message('u1', 'user', '生成完整长篇施工组织设计 Markdown 文件。'),
        message('t1', 'tool', 'Write Failed', {
          toolStatus: 'error',
          toolName: 'Write',
          toolInput: {
            content: '# C1.2 全节证据矩阵 — 正式审计 Handoff Note\n\n## Part A: BOQ xlsx 逐行交叉验证\n\n长文档内容...',
          },
          toolResult: 'Validation failed for tool "write":\n  - path: must have required properties path\n\nReceived arguments:\n{\n  "content": "# C1.2 全节证据矩阵 — 正式审计 Handoff Note"\n}',
        }),
        message('a1', 'assistant', 'Write 工具校验失败，我继续重新写完整文件。'),
      ],
      stoppedReason: 'complete',
      now: 10,
    })

    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.result.failureCategories).toContain('tool_failure')
      expect(decision.result.evidence).toContainEqual(expect.objectContaining({
        type: 'tool',
        label: 'artifact_write_failure',
      }))
      expect(decision.prompt).toContain('include the exact target path')
      expect(decision.prompt).toContain('Do not resend document content without a path')
      expect(decision.prompt).toContain('Resume from the artifact manifest and completed section chunks')
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
