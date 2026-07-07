import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Stub the preferences module so we can toggle `getCoAuthorPreference` per test
// without touching disk. `formatPreferencesForPrompt` is stubbed to '' because
// it's unrelated to the behavior under test here.
let mockIncludeCoAuthoredBy = true
mock.module('../../config/preferences.ts', () => ({
  getCoAuthorPreference: () => mockIncludeCoAuthoredBy,
  formatPreferencesForPrompt: () => '',
}))

import { getSystemPrompt, getWorkingDirectoryContext } from '../system'

const GIT_CONVENTIONS_HEADING = '## Git Conventions'
const CO_AUTHOR_TRAILER = 'Co-Authored-By: Agent π <agents-noreply@craft.do>'

describe('system prompt guidance', () => {
  it('frames the working directory as a boundary and output location, not an implicit evidence corpus', () => {
    const context = getWorkingDirectoryContext('/tmp/project', false)

    expect(context).toContain('not an implicit evidence corpus')
    expect(context).toContain('Do not list, search, or analyze this folder by default')
    expect(context).toContain('Use selected sources, attached files, and user-named file or folder paths as task input')
  })

  it('uses backend-neutral debug log querying guidance (rg/grep via Bash)', () => {
    const prompt = getSystemPrompt(
      undefined,
      { enabled: true, logFilePath: '/tmp/main.log' },
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain('Use Bash with `rg`/`grep` to search logs efficiently:')
    expect(prompt).toContain('rg -n "session" "/tmp/main.log"')
    expect(prompt).not.toContain('Use the Grep tool (if available)')
    expect(prompt).not.toContain('Grep pattern=')
  })

  it('does not mention Grep in call_llm tool-dependency guidance', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('The subtask needs file/shell tools (for example, Read or Bash)')
    expect(prompt).not.toContain('The subtask needs tools (Read, Bash, Grep)')
  })

  it('keeps permission-mode read/search guidance scoped to selected or user-named inputs', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('Explore selected sources, user-named files/folders, and necessary implementation files')
    expect(prompt).toContain('Read operations are allowed, but still follow the input-scope policy above.')
    expect(prompt).not.toContain('Read-only. Explore, search, read files.')
  })

  it('requires source guides before external source tool calls', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('Before calling any tool from an external source, read that source')
    expect(prompt).toContain('guide.md')
    expect(prompt).toContain('If a source tool is rejected because its guide was not read')
    expect(prompt).toContain('do not retry the source tool or guess parameters')
  })

  it('requires skill instructions and referenced files before skill execution', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('Before applying a skill')
    expect(prompt).toContain('read the entire `SKILL.md`')
    expect(prompt).toContain('read those required instruction/reference files before executing the skill')
    expect(prompt).toContain('do not use the skill from memory or the skill name alone')
  })

  it('guides long markdown deliverables through chunked artifact writing', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('For long Markdown deliverables')
    expect(prompt).toContain('write a manifest plus section chunks first')
    expect(prompt).toContain('Do not send a long document body through one Write tool call')
    expect(prompt).toContain('do not use heredoc or oversized inline Python/Bash strings')
    expect(prompt).toContain('Every Write/Edit/MultiEdit call must include the explicit absolute target path or file_path')
    expect(prompt).toContain('never send only content')
    expect(prompt).toContain('If a section write fails, retry only that section')
  })
})

describe('includeCoAuthoredBy handling', () => {
  beforeEach(() => {
    mockIncludeCoAuthoredBy = true
  })

  it('includes the Git Conventions block when the arg is explicitly true', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      true
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })

  it('omits the Git Conventions block when the arg is explicitly false', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      false
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  // Regression test for #576: Pi-backed sessions called getSystemPrompt without
  // the 7th arg, and the function silently defaulted to `true`, ignoring the
  // user's preference. The defensive fallback in getSystemPrompt should now
  // resolve to getCoAuthorPreference() when the arg is omitted.
  it('falls back to getCoAuthorPreference() when the arg is omitted (#576)', () => {
    mockIncludeCoAuthoredBy = false

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      'Agent π Backend'
      // 7th arg omitted — must not regress to `true` default
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  it('falls back to getCoAuthorPreference() === true when the arg is omitted and the user has not opted out', () => {
    mockIncludeCoAuthoredBy = true

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })
})
