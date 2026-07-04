import { describe, expect, it } from 'bun:test'
import type { LoadedSource } from '../../../shared/types'
import { buildKnowledgeBaseSourceSections } from './knowledge-base-source-list-view-model'

function source(name: string, slug: string, folder?: string): LoadedSource {
  return {
    config: {
      id: slug,
      name,
      slug,
      enabled: true,
      provider: 'file-memory',
      type: 'mcp',
      metadata: folder
        ? {
            category: 'knowledge_base',
            knowledgeCategory: folder,
            knowledgeFolder: folder,
            scope: 'global',
            sourceKind: 'file-memory',
          }
        : undefined,
    },
    guide: null,
    folderPath: `C:/sources/${slug}`,
    workspaceRootPath: 'C:/workspace',
    workspaceId: 'global',
  }
}

describe('buildKnowledgeBaseSourceSections', () => {
  it('groups knowledge base sources by normalized folder and sorts each group', () => {
    const sections = buildKnowledgeBaseSourceSections([
      source('Schedule B', 'schedule-b', 'Construction\\Schedule'),
      source('Ordinary MCP', 'ordinary'),
      source('Standard A', 'standard-a', 'Tender Standards'),
      source('Schedule A', 'schedule-a', 'Construction/Schedule'),
    ])

    expect(sections.map(section => ({
      folder: section.folder,
      label: section.label,
      description: section.description,
      collapsible: section.collapsible,
      sourceNames: section.sources.map(item => item.config.name),
    }))).toEqual([
      { folder: 'Construction/Schedule', label: 'Schedule', description: 'Construction', collapsible: true, sourceNames: ['Schedule A', 'Schedule B'] },
      { folder: 'Tender Standards', label: 'Tender Standards', description: undefined, collapsible: true, sourceNames: ['Standard A'] },
    ])
  })
})
