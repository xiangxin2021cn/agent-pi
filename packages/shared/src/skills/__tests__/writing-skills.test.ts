import { describe, expect, it } from 'bun:test'
import { resolve } from 'path'
import { loadSkillBySlug } from '../storage.ts'

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..')

describe('first-party writing skills', () => {
  it('loads professional-report with producer rules and marketplace ban', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'professional-report', PROJECT_ROOT)
    expect(skill).not.toBeNull()
    expect(skill!.content).toContain('reader decision')
    expect(skill!.content).toContain('Do not install marketplace skills')
    expect(skill!.content).toContain('综上所述')
    expect(skill!.content).toContain('Self-check')
  })
})
