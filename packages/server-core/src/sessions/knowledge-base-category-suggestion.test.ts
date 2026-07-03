import { describe, expect, it } from 'bun:test'
import {
  buildKnowledgeBaseCategoryFallback,
  normalizeKnowledgeBaseCategorySuggestion,
} from './knowledge-base-category-suggestion'

describe('knowledge base category suggestion helpers', () => {
  it('normalizes JSON model output into a folder-like category', () => {
    expect(normalizeKnowledgeBaseCategorySuggestion(
      '```json\n{"category":" Tender Standards \\\\ Specs ","reason":"matches existing tender folders"}\n```',
      'General'
    )).toEqual({
      category: 'Tender Standards/Specs',
      reason: 'matches existing tender folders',
    })
  })

  it('falls back to the deterministic suggestion when model output is empty or invalid', () => {
    expect(normalizeKnowledgeBaseCategorySuggestion('///', 'General')).toEqual({
      category: 'General',
      reason: undefined,
    })
    expect(normalizeKnowledgeBaseCategorySuggestion('{"category":', 'General')).toEqual({
      category: 'General',
      reason: undefined,
    })
    expect(normalizeKnowledgeBaseCategorySuggestion('{}', 'General')).toEqual({
      category: 'General',
      reason: undefined,
    })
  })

  it('builds a deterministic fallback from file path and existing categories', () => {
    expect(buildKnowledgeBaseCategoryFallback({
      fileName: 'method-statement-review.md',
      filePath: 'C:/Project/Agent Pi Outputs/method-statement-review.md',
      existingCategories: ['Reviews/Method Statements'],
    })).toBe('Reviews/Method Statements')
  })
})
