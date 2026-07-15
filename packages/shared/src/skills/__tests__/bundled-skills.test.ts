import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setBundledAssetsRoot } from '../../utils/paths.ts'
import { invalidateSkillsCache, loadSkillBySlug } from '../storage.ts'

const root = mkdtempSync(join(tmpdir(), 'agent-pi-bundled-skills-'))
const workspace = join(root, 'workspace')
const slug = 'agent-pi-test-bundled-skill'

describe('bundled application skills', () => {
  beforeAll(() => {
    const skillDir = join(root, 'resources', 'skills', slug)
    mkdirSync(skillDir, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: Bundled test\ndescription: test\n---\n\nBundled instructions.\n`)
    setBundledAssetsRoot(root)
    invalidateSkillsCache()
  })

  afterAll(() => {
    setBundledAssetsRoot(process.cwd())
    invalidateSkillsCache()
    rmSync(root, { recursive: true, force: true })
  })

  test('loads a bundled skill when no user override exists', () => {
    const skill = loadSkillBySlug(workspace, slug)

    expect(skill?.slug).toBe(slug)
    expect(skill?.content).toContain('Bundled instructions.')
  })
})
