import type { SessionDocumentGenre } from '../sessions/types.ts'

export const TENDER_FORMAL_WRITING_SKILL_SLUG = 'tender-formal-writing'
export const PROFESSIONAL_REPORT_SKILL_SLUG = 'professional-report'

const TENDER_GENRES: SessionDocumentGenre[] = ['tender_submission', 'method_statement']
const REPORT_GENRES: SessionDocumentGenre[] = [
  'research_report',
  'analysis_report',
  'due_diligence_report',
  'management_brief',
  'general_document',
]

export function resolveWritingSkillSlug(input: {
  genre?: SessionDocumentGenre
  module?: string
}): string | undefined {
  if (input.module === 'tender') return TENDER_FORMAL_WRITING_SKILL_SLUG
  if (input.genre && TENDER_GENRES.includes(input.genre)) return TENDER_FORMAL_WRITING_SKILL_SLUG
  if (input.genre && REPORT_GENRES.includes(input.genre)) return PROFESSIONAL_REPORT_SKILL_SLUG
  return undefined
}

export function resolveAvailableWritingSkillSlug(input: {
  preferredSlug: string | undefined
  loadSkill: (slug: string) => { slug: string } | null
}): { slug: string; fallback: boolean } | undefined {
  if (input.preferredSlug && input.loadSkill(input.preferredSlug)) {
    return { slug: input.preferredSlug, fallback: false }
  }
  if (input.preferredSlug !== PROFESSIONAL_REPORT_SKILL_SLUG && input.loadSkill(PROFESSIONAL_REPORT_SKILL_SLUG)) {
    return { slug: PROFESSIONAL_REPORT_SKILL_SLUG, fallback: true }
  }
  return undefined
}
