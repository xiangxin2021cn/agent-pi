import { describe, expect, it } from 'bun:test'
import type { StoredAttachment } from '@craft-agent/core/types'
import { buildGoalCriteriaFromMessage, buildGoalExecutionPolicyFromMessage } from './goal-criteria'

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
