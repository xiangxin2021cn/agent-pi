import { describe, expect, it } from 'bun:test'
import type { StoredAttachment } from '@craft-agent/core/types'
import {
  COMPREHENSIVE_QUALITY_CRITERION_TEXT,
  DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
  FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
  TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
  buildGoalCriteriaFromMessage,
  buildGoalExecutionPolicyFromMessage,
} from './goal-criteria'

function attachment(name: string): StoredAttachment {
  return {
    id: name,
    type: 'pdf',
    name,
    mimeType: 'application/octet-stream',
    size: 1,
    storedPath: `/tmp/${name}`,
  }
}

describe('buildGoalCriteriaFromMessage', () => {
  it('always includes the base deliverable criterion for work tasks', () => {
    const criteria = buildGoalCriteriaFromMessage({ message: '修复上传附件按钮' })

    expect(criteria).toContainEqual({
      text: 'Complete the user request, including any requested deliverables, constraints, referenced files, and verification steps.',
      kind: 'deliverable',
      required: true,
    })
  })

  it('adds evidence and format criteria for document work with attachments', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件生成一份施工方案报告',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(criteria.map(criterion => criterion.kind)).toContain('evidence')
    expect(criteria.map(criterion => criterion.kind)).toContain('format')
    expect(criteria.some(criterion => criterion.text.includes('tender.pdf'))).toBe(true)
    expect(criteria).toContainEqual({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  })

  it('adds verification criteria when the request asks for tests or validation', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '修复这个 bug 并验证测试通过',
    })

    expect(criteria).toContainEqual({
      text: 'Run or describe appropriate validation steps, and report the verification result clearly.',
      kind: 'test',
      required: true,
    })
  })

  it('adds evidence criteria for source-sensitive work even without explicit attachments', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件条款和 BOQ 工程量清单写施工方案',
    })

    expect(criteria).toContainEqual({
      text: 'Ground key facts, figures, clauses, and requirements in available source material; clearly mark assumptions when source evidence is unavailable.',
      kind: 'evidence',
      required: true,
    })
  })

  it('does not duplicate generic source criteria when referenced files are present', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '根据招标文件和 BOQ 工程量清单写施工方案',
      storedAttachments: [attachment('boq.xlsx')],
    })

    const evidenceCriteria = criteria.filter(criterion => criterion.kind === 'evidence')
    expect(evidenceCriteria).toHaveLength(1)
    expect(evidenceCriteria[0].text).toContain('boq.xlsx')
  })

  it('adds output-file evidence criteria when the request explicitly asks to create a file', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请生成 final-report.md 文件并保存到工作目录',
    })

    expect(criteria).toContainEqual({
      text: FILE_OUTPUT_REQUIRED_CRITERION_TEXT,
      kind: 'deliverable',
      required: true,
    })
  })

  it('adds output-file evidence criteria when the request asks to convert into a file format', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请将 tender.pdf 转换为 markdown 文件',
    })

    expect(criteria.some(criterion => criterion.text === FILE_OUTPUT_REQUIRED_CRITERION_TEXT)).toBe(true)
  })

  it('adds explicit output format criteria when the request names deliverable formats', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请生成 PDF 和 Word 版分析报告',
    })

    expect(criteria).toContainEqual({
      text: 'Create output file(s) in the requested format(s): PDF, DOCX.',
      kind: 'format',
      required: true,
    })
  })

  it('uses the target format instead of the source format for conversions', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请将 tender.pdf 转换为 markdown 文件',
    })

    const outputFormat = criteria.find(criterion =>
      criterion.kind === 'format'
      && criterion.text.startsWith('Create output file(s) in the requested format(s):')
    )
    expect(outputFormat?.text).toBe('Create output file(s) in the requested format(s): MD.')
  })

  it('does not require output-file evidence for source-only document analysis', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析 tender.pdf 的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === FILE_OUTPUT_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('adds tool verification evidence criteria when the request asks to run tests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请运行 typecheck 和测试，确认全部通过',
    })

    expect(criteria).toContainEqual({
      text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
      kind: 'test',
      required: true,
    })
  })

  it('adds tool verification evidence criteria for code or app change requests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请修复前端上传附件按钮的 bug',
    })

    expect(criteria).toContainEqual({
      text: TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT,
      kind: 'test',
      required: true,
    })
  })

  it('does not require tool verification evidence when the request only asks to describe validation', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请描述这个方案的验证思路',
    })

    expect(criteria.some(criterion => criterion.text === TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('does not require tool verification evidence for ordinary document analysis', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析施工方案的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === TOOL_VERIFICATION_REQUIRED_CRITERION_TEXT)).toBe(false)
  })

  it('adds a coverage criterion when the request asks for comprehensive high-quality work', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请全面详细分析这个项目并输出高质量报告',
    })

    expect(criteria).toContainEqual({
      text: COMPREHENSIVE_QUALITY_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: DOCUMENT_QUALITY_REQUIRED_CRITERION_TEXT,
      kind: 'coverage',
      required: true,
    })
  })

  it('adds separate criteria for explicit required deliverable items', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: [
        '请生成施工方案报告，必须包含：',
        '1. 工程概况',
        '2. 风险清单',
        '3. 引用页码',
      ].join('\n'),
    })

    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 工程概况.',
      kind: 'user_constraint',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 风险清单.',
      kind: 'user_constraint',
      required: true,
    })
    expect(criteria).toContainEqual({
      text: 'Must satisfy explicit user requirement: 引用页码.',
      kind: 'user_constraint',
      required: true,
    })
  })

  it('does not add a coverage criterion for ordinary short analysis requests', () => {
    const criteria = buildGoalCriteriaFromMessage({
      message: '请分析这个项目的关键风险',
    })

    expect(criteria.some(criterion => criterion.text === COMPREHENSIVE_QUALITY_CRITERION_TEXT)).toBe(false)
  })
})

describe('buildGoalExecutionPolicyFromMessage', () => {
  it('uses a conservative two-pass budget for ordinary work requests', () => {
    const policy = buildGoalExecutionPolicyFromMessage({ message: '修复上传附件按钮' })

    expect(policy).toEqual({
      mode: 'auto_improve',
      maxIterations: 2,
      maxWallClockMs: 15 * 60 * 1000,
    })
  })

  it('allows more passes for comprehensive review requests with documents', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '请全面详细分析招标文件并认真复核输出质量',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(policy.maxIterations).toBe(3)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('allows more passes for source-sensitive document work with attachments', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '招标文件条款有哪些风险？',
      storedAttachments: [attachment('tender.pdf')],
    })

    expect(policy.maxIterations).toBe(3)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('allows more passes when the user explicitly asks for high-quality comprehensive work', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '请全面详细分析这个项目并输出高质量报告',
    })

    expect(policy.maxIterations).toBe(3)
    expect(policy.maxWallClockMs).toBe(30 * 60 * 1000)
  })

  it('uses the highest bounded budget when the user explicitly asks to continue until done', () => {
    const policy = buildGoalExecutionPolicyFromMessage({
      message: '反复检查并继续改进，直到成果满足要求再结束',
    })

    expect(policy.maxIterations).toBe(4)
    expect(policy.maxWallClockMs).toBe(45 * 60 * 1000)
  })
})
