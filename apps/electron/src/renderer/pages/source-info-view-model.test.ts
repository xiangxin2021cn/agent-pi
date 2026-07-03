import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '../../shared/types'
import { buildKnowledgeBaseInfoRows } from './source-info-view-model'

function sourceWithMetadata(metadata: Record<string, unknown> | undefined): LoadedSource {
  return {
    config: {
      id: 'source_1234',
      name: 'Tender Knowledge',
      slug: 'file-memory-tender-knowledge',
      enabled: false,
      provider: 'file-memory',
      type: 'mcp',
      metadata,
    },
    guide: null,
    folderPath: '/workspace/sources/file-memory-tender-knowledge',
    workspaceRootPath: '/workspace',
    workspaceId: 'workspace',
  } as LoadedSource
}

describe('buildKnowledgeBaseInfoRows', () => {
  test('returns no rows for ordinary sources', () => {
    expect(buildKnowledgeBaseInfoRows(sourceWithMetadata(undefined))).toEqual([])
  })

  test('returns knowledge base metadata rows for source details', () => {
    const rows = buildKnowledgeBaseInfoRows(sourceWithMetadata({
      category: 'knowledge_base',
      collectionId: 'local-file-memory',
      knowledgeCategory: 'Tender Standards/Method Statements',
      knowledgeFolder: 'Tender Standards/Method Statements',
      tags: [' tender ', 'standards'],
      sourceFilePath: 'C:/Project/Agent Pi Outputs/company-standard.md',
      scope: 'global',
      sourceKind: 'file-memory',
      fileExtension: '.md',
    }))

    expect(rows).toContainEqual(expect.objectContaining({
      labelKey: 'sourceInfo.knowledgeBaseCategory',
      value: 'Tender Standards/Method Statements',
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      labelKey: 'sourceInfo.knowledgeBaseTags',
      value: 'tender, standards',
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      labelKey: 'sourceInfo.knowledgeBaseSourceFile',
      value: 'C:/Project/Agent Pi Outputs/company-standard.md',
    }))
  })
})
