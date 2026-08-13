import { describe, expect, test } from 'bun:test'
import {
  PROFESSIONAL_REPORT_SKILL_SLUG,
  TENDER_FORMAL_WRITING_SKILL_SLUG,
  resolveAvailableWritingSkillSlug,
  resolveWritingSkillSlug,
} from './writing-skill-resolver.ts'

describe('resolveWritingSkillSlug', () => {
  test('maps tender module and tender genres to tender-formal-writing', () => {
    expect(resolveWritingSkillSlug({ module: 'tender' })).toBe(TENDER_FORMAL_WRITING_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'tender_submission' })).toBe(TENDER_FORMAL_WRITING_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'method_statement' })).toBe(TENDER_FORMAL_WRITING_SKILL_SLUG)
  })

  test('maps research/analysis/diligence/brief/general to professional-report', () => {
    expect(resolveWritingSkillSlug({ genre: 'research_report' })).toBe(PROFESSIONAL_REPORT_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'analysis_report' })).toBe(PROFESSIONAL_REPORT_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'due_diligence_report' })).toBe(PROFESSIONAL_REPORT_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'management_brief' })).toBe(PROFESSIONAL_REPORT_SKILL_SLUG)
    expect(resolveWritingSkillSlug({ genre: 'general_document' })).toBe(PROFESSIONAL_REPORT_SKILL_SLUG)
  })

  test('does not attach a writing skill for correspondence', () => {
    expect(resolveWritingSkillSlug({ genre: 'contractual_correspondence' })).toBeUndefined()
  })
})

describe('resolveAvailableWritingSkillSlug', () => {
  test('falls back to professional-report when preferred skill is missing', () => {
    const resolved = resolveAvailableWritingSkillSlug({
      preferredSlug: TENDER_FORMAL_WRITING_SKILL_SLUG,
      loadSkill: (slug) => slug === PROFESSIONAL_REPORT_SKILL_SLUG ? { slug } : null,
    })
    expect(resolved).toEqual({ slug: PROFESSIONAL_REPORT_SKILL_SLUG, fallback: true })
  })

  test('returns undefined instead of searching a marketplace when both skills are missing', () => {
    const resolved = resolveAvailableWritingSkillSlug({
      preferredSlug: TENDER_FORMAL_WRITING_SKILL_SLUG,
      loadSkill: () => null,
    })
    expect(resolved).toBeUndefined()
  })
})
