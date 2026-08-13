import { describe, expect, test } from 'bun:test'
import { attachWritingSkillToSend } from './writing-skill-attach.ts'

describe('attachWritingSkillToSend', () => {
  test('prefixes [skill:professional-report] for professional analysis and skips quick mode', () => {
    const attached = attachWritingSkillToSend({
      message: '请写一份尽调分析报告',
      skillSlugs: [],
      documentQualityMode: 'professional_document',
      genre: 'due_diligence_report',
      loadSkill: (slug) => ({ slug }),
    })
    expect(attached.skillSlugs).toContain('professional-report')
    expect(attached.message.startsWith('[skill:professional-report]')).toBe(true)
    expect(attached.missing).toBe(false)

    const skipped = attachWritingSkillToSend({
      message: '请写一份尽调分析报告',
      skillSlugs: [],
      documentQualityMode: 'quick',
      genre: 'due_diligence_report',
      loadSkill: (slug) => ({ slug }),
    })
    expect(skipped.skillSlugs).toEqual([])
    expect(skipped.message.startsWith('[skill:')).toBe(false)
  })

  test('does not duplicate an existing mention and never invents a marketplace slug', () => {
    const attached = attachWritingSkillToSend({
      message: '[skill:professional-report]\n继续改第三章',
      skillSlugs: ['professional-report'],
      documentQualityMode: 'strict_delivery',
      genre: 'analysis_report',
      loadSkill: (slug) => ({ slug }),
    })
    expect(attached.message.match(/\[skill:professional-report\]/g)?.length).toBe(1)

    const missing = attachWritingSkillToSend({
      message: '请写一份尽调分析报告',
      skillSlugs: [],
      documentQualityMode: 'professional_document',
      genre: 'due_diligence_report',
      loadSkill: () => null,
    })
    expect(missing.missing).toBe(true)
    expect(missing.message.startsWith('[skill:')).toBe(false)
    expect(missing.skillSlugs).toEqual([])
  })

  test('skips contractual correspondence even on a formal document mode', () => {
    const attached = attachWritingSkillToSend({
      message: '请根据附件写一封正式回信。',
      skillSlugs: [],
      documentQualityMode: 'professional_document',
      genre: 'contractual_correspondence',
      loadSkill: (slug) => ({ slug }),
    })
    expect(attached.skillSlugs).toEqual([])
    expect(attached.message.startsWith('[skill:')).toBe(false)
  })
})
