import {
  normalizeKnowledgeBaseFolder,
  suggestKnowledgeBaseCategory,
  type KnowledgeBaseCategorySuggestionInput,
} from '@craft-agent/shared/sources/knowledge-base'

export interface KnowledgeBaseCategorySuggestionResult {
  category: string
  reason?: string
}

export function buildKnowledgeBaseCategoryFallback(input: KnowledgeBaseCategorySuggestionInput): string {
  return suggestKnowledgeBaseCategory(input)
}

export function normalizeKnowledgeBaseCategorySuggestion(
  raw: string,
  fallbackCategory: string
): KnowledgeBaseCategorySuggestionResult {
  const fallback = normalizeKnowledgeBaseFolder(fallbackCategory) ?? 'General'
  const cleaned = stripCodeFence(raw).trim()
  const parsed = parseJsonSuggestion(cleaned)
  if (cleaned.startsWith('{') && !parsed) {
    return { category: fallback, reason: undefined }
  }
  const category = parsed
    ? (normalizeKnowledgeBaseFolder(parsed.category) ?? fallback)
    : (normalizeKnowledgeBaseFolder(cleaned) ?? fallback)

  return {
    category,
    reason: normalizeReason(parsed?.reason),
  }
}

export function buildKnowledgeBaseCategorySuggestionInstruction(input: KnowledgeBaseCategorySuggestionInput & {
  fallbackCategory: string
}): string {
  const existing = (input.existingCategories ?? [])
    .map(normalizeKnowledgeBaseFolder)
    .filter((category): category is string => Boolean(category))
  const existingText = existing.length > 0 ? existing.map(category => `- ${category}`).join('\n') : '- General'

  return [
    'You are organizing a user-managed Knowledge Base with Obsidian-like folder categories.',
    'Recommend exactly one folder-like category for the file.',
    'Prefer an existing category when it fits. Use slash-separated folders when useful.',
    'Return only compact JSON with keys "category" and "reason".',
    '',
    `File name: ${input.fileName}`,
    input.filePath ? `File path: ${input.filePath}` : null,
    `Fallback category: ${input.fallbackCategory}`,
    '',
    'Existing categories:',
    existingText,
    '',
    'Rules:',
    '- Do not return a filesystem path.',
    '- Do not include file extensions.',
    '- Keep the category concise and stable for reuse.',
    '- Use the same language as the existing categories when possible.',
    '',
    'Example response: {"category":"Tender Standards/Specifications","reason":"The file is a specification reference and matches an existing tender standards folder."}',
  ].filter(Boolean).join('\n')
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
}

function parseJsonSuggestion(value: string): { category?: string; reason?: string } | null {
  if (!value.startsWith('{')) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return {
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    return null
  }
}

function normalizeReason(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
