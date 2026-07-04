import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '../../../../shared/types'
import {
  buildKnowledgeBaseSelectorSections,
  setKnowledgeBaseSelection,
  toggleKnowledgeBaseSlug,
} from '../knowledge-base-selector-view-model'

function source(slug: string, name: string, folder?: string): LoadedSource {
  return {
    config: {
      id: slug,
      name,
      slug,
      enabled: false,
      provider: 'file-memory',
      type: 'mcp',
      metadata: folder
        ? {
            category: 'knowledge_base',
            knowledgeCategory: folder,
            knowledgeFolder: folder,
            scope: 'global',
          }
        : undefined,
    },
    guide: null,
    folderPath: `/workspace/sources/${slug}`,
    workspaceRootPath: '/workspace',
    workspaceId: 'workspace',
  } as LoadedSource
}

describe('knowledge base selector view model', () => {
  test('groups only knowledge base sources by folder', () => {
    const sections = buildKnowledgeBaseSelectorSections([
      source('kb-c', 'C', 'Tender/Pricing'),
      source('plain', 'Plain'),
      source('kb-a', 'A', 'Tender/Pricing'),
      source('kb-b', 'B', 'Standards'),
    ])

    expect(sections.map(section => [section.folder, section.sources.map(item => item.config.slug)])).toEqual([
      ['Standards', ['kb-b']],
      ['Tender/Pricing', ['kb-a', 'kb-c']],
    ])
  })

  test('selects or clears all knowledge base slugs without changing ordinary sources', () => {
    expect(setKnowledgeBaseSelection(['api'], ['kb-a', 'kb-b'], true)).toEqual(['api', 'kb-a', 'kb-b'])
    expect(setKnowledgeBaseSelection(['api', 'kb-a', 'kb-b'], ['kb-a', 'kb-b'], false)).toEqual(['api'])
  })

  test('toggles one knowledge base slug while preserving order', () => {
    expect(toggleKnowledgeBaseSlug(['api'], 'kb-a')).toEqual(['api', 'kb-a'])
    expect(toggleKnowledgeBaseSlug(['api', 'kb-a'], 'kb-a')).toEqual(['api'])
  })
})
