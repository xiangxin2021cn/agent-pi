export interface MarkdownSelectionRewriteInput {
  selectedText: string
  instruction: string
  fullContent: string
  filePath?: string
}

function asCdata(value: string): string {
  return value.replaceAll(']]>', ']]]]><![CDATA[>')
}

function stripOuterBlankLines(value: string): string {
  return value.replace(/^\s*\n/, '').replace(/\n\s*$/, '')
}

export function buildMarkdownSelectionRewritePrompt(input: MarkdownSelectionRewriteInput): string {
  const fileLine = input.filePath ? `file: ${input.filePath}\n` : ''
  return `You are rewriting a selected Markdown excerpt inside Agent Pi's document editor.
Use the current workspace context and project memory if available, but do not modify files or run tools.
Return only the replacement content wrapped in <replacement> tags.

${fileLine}<selection_rewrite_request>
<instruction><![CDATA[${asCdata(input.instruction)}]]></instruction>
<selected_text><![CDATA[${asCdata(input.selectedText)}]]></selected_text>
<full_document><![CDATA[${asCdata(input.fullContent)}]]></full_document>
</selection_rewrite_request>

Output format:
<replacement>
final replacement Markdown only
</replacement>`
}

export function extractMarkdownSelectionReplacement(content: string): string {
  const tagged = content.match(/<replacement>\s*([\s\S]*?)\s*<\/replacement>/i)
  if (tagged?.[1] != null) {
    return stripOuterBlankLines(tagged[1])
  }

  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1] != null) {
    return stripOuterBlankLines(fenced[1])
  }

  return trimmed
}
