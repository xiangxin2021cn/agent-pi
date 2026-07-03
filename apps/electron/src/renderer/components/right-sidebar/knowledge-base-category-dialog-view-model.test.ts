import { describe, expect, it } from 'bun:test'
import {
  buildKnowledgeBaseCategoryOptions,
  resolveKnowledgeBaseDialogValue,
} from './knowledge-base-category-dialog-view-model'

describe('knowledge base category dialog view model', () => {
  it('puts the suggested category first and deduplicates existing folders', () => {
    const options = buildKnowledgeBaseCategoryOptions({
      suggestedCategory: 'Tender Standards/Method Statements',
      existingCategories: [
        'Tender Standards/Method Statements',
        'Tender Standards/Specifications',
        ' Tender Standards / Specifications ',
      ],
    })

    expect(options.map(option => option.value)).toEqual([
      'Tender Standards/Method Statements',
      'Tender Standards/Specifications',
    ])
    expect(options[0]?.isSuggested).toBe(true)
  })

  it('normalizes custom category input', () => {
    expect(resolveKnowledgeBaseDialogValue(' Tender Standards \\\\ Specs / ')).toBe('Tender Standards/Specs')
    expect(resolveKnowledgeBaseDialogValue('///')).toBeNull()
  })
})
