import type { SessionDocumentGenre, SessionDocumentQualityMode } from '@craft-agent/shared/sessions'
import {
  PROFESSIONAL_REPORT_SKILL_SLUG,
  resolveAvailableWritingSkillSlug,
  resolveWritingSkillSlug,
} from '@craft-agent/shared/business-projects'

const QUICK_MODES = new Set<SessionDocumentQualityMode>(['quick', 'native_quick'])
const FORMAL_MODES = new Set<SessionDocumentQualityMode>([
  'professional_document',
  'strict_delivery',
  'multi_agent_deep',
])

export function attachWritingSkillToSend(input: {
  message: string
  skillSlugs: string[]
  documentQualityMode?: SessionDocumentQualityMode
  genre?: SessionDocumentGenre
  module?: string
  loadSkill: (slug: string) => { slug: string } | null
}): { message: string; skillSlugs: string[]; missing: boolean; fallback?: boolean } {
  if (
    !input.documentQualityMode
    || QUICK_MODES.has(input.documentQualityMode)
    || input.genre === 'contractual_correspondence'
  ) {
    return { message: input.message, skillSlugs: input.skillSlugs, missing: false }
  }

  const preferredSlug = resolveWritingSkillSlug({ genre: input.genre, module: input.module })
    ?? (FORMAL_MODES.has(input.documentQualityMode) ? PROFESSIONAL_REPORT_SKILL_SLUG : undefined)

  const resolved = resolveAvailableWritingSkillSlug({
    preferredSlug,
    loadSkill: input.loadSkill,
  })

  if (!resolved) {
    return {
      message: input.message,
      skillSlugs: input.skillSlugs,
      missing: Boolean(preferredSlug),
    }
  }

  const skillTag = `[skill:${resolved.slug}]`
  const message = input.message.includes(skillTag)
    ? input.message
    : `${skillTag}\n${input.message}`
  const skillSlugs = input.skillSlugs.includes(resolved.slug)
    ? input.skillSlugs
    : [...input.skillSlugs, resolved.slug]

  return {
    message,
    skillSlugs,
    missing: false,
    fallback: resolved.fallback,
  }
}
