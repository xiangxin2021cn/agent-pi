import { describe, expect, it } from 'bun:test'
import {
  buildMarkdownSelectionRewritePrompt,
  extractMarkdownSelectionReplacement,
} from '../selection-rewrite'

describe('selection rewrite helpers', () => {
  it('builds a no-tool rewrite prompt with selected text and document context', () => {
    const prompt = buildMarkdownSelectionRewritePrompt({
      selectedText: 'old paragraph',
      instruction: 'make it concise',
      fullContent: '# Title\n\nold paragraph',
      filePath: 'C:/work/doc.md',
    })

    expect(prompt).toContain('do not modify files or run tools')
    expect(prompt).toContain('C:/work/doc.md')
    expect(prompt).toContain('<selected_text><![CDATA[old paragraph]]></selected_text>')
    expect(prompt).toContain('<replacement>')
  })

  it('extracts replacement tags before applying content back to the editor', () => {
    expect(extractMarkdownSelectionReplacement('<replacement>\n**new** text\n</replacement>')).toBe('**new** text')
  })

  it('falls back to fenced markdown or trimmed plain text', () => {
    expect(extractMarkdownSelectionReplacement('```markdown\n- item\n```')).toBe('- item')
    expect(extractMarkdownSelectionReplacement('\nplain result\n')).toBe('plain result')
  })
})
