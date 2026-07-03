import { normalizeKnowledgeBaseFolder } from '@craft-agent/shared/sources/knowledge-base'

export interface KnowledgeBaseCategoryOption {
  value: string
  isSuggested: boolean
}

export interface KnowledgeBaseCategoryOptionsInput {
  suggestedCategory?: string | null
  existingCategories: string[]
}

export function buildKnowledgeBaseCategoryOptions(input: KnowledgeBaseCategoryOptionsInput): KnowledgeBaseCategoryOption[] {
  const options: KnowledgeBaseCategoryOption[] = []
  const seen = new Set<string>()

  const add = (value: string | null | undefined, isSuggested: boolean) => {
    const normalized = normalizeKnowledgeBaseFolder(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    options.push({ value: normalized, isSuggested })
  }

  add(input.suggestedCategory, true)
  for (const category of input.existingCategories) {
    add(category, false)
  }

  return options
}

export function resolveKnowledgeBaseDialogValue(value: string): string | null {
  return normalizeKnowledgeBaseFolder(value)
}
