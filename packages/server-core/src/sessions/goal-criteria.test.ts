import { describe, expect, it } from 'bun:test'
import type { StoredAttachment } from '@craft-agent/core/types'
import { buildGoalCriteriaFromMessage } from './goal-criteria'

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
})
