import { describe, expect, test } from 'bun:test';
import type { LoadedSource } from './types.ts';
import {
  KNOWLEDGE_BASE_METADATA_CATEGORY,
  getKnowledgeBaseCategory,
  isKnowledgeBaseSource,
  isSupportedKnowledgeBaseFile,
} from './knowledge-base.ts';

function sourceWithMetadata(metadata: Record<string, unknown> | undefined): LoadedSource {
  return {
    config: {
      id: 'source_1234',
      name: 'Tender Knowledge',
      slug: 'file-memory-tender-knowledge',
      enabled: false,
      provider: 'file-memory',
      type: 'mcp',
      mcp: {
        transport: 'stdio',
        command: 'bun',
        args: ['server.js'],
      },
      metadata,
    },
    guide: null,
    folderPath: '/workspace/sources/file-memory-tender-knowledge',
    workspaceRootPath: '/workspace',
    workspaceId: 'workspace',
  } as LoadedSource;
}

describe('knowledge base source metadata', () => {
  test('identifies knowledge base sources without changing the source type', () => {
    const source = sourceWithMetadata({
      category: KNOWLEDGE_BASE_METADATA_CATEGORY,
      knowledgeCategory: 'Tender Standards/Method Statements',
      knowledgeFolder: 'Tender Standards/Method Statements',
      scope: 'global',
    });

    expect(source.config.type).toBe('mcp');
    expect(isKnowledgeBaseSource(source)).toBe(true);
    expect(getKnowledgeBaseCategory(source)).toBe('Tender Standards/Method Statements');
  });

  test('does not treat ordinary MCP sources as knowledge base sources', () => {
    const source = sourceWithMetadata(undefined);

    expect(isKnowledgeBaseSource(source)).toBe(false);
    expect(getKnowledgeBaseCategory(source)).toBeNull();
  });

  test('only supports text-like MVP file formats', () => {
    expect(isSupportedKnowledgeBaseFile('report.md')).toBe(true);
    expect(isSupportedKnowledgeBaseFile('notes.TXT')).toBe(true);
    expect(isSupportedKnowledgeBaseFile('manifest.json')).toBe(true);
    expect(isSupportedKnowledgeBaseFile('drawing.pdf')).toBe(false);
    expect(isSupportedKnowledgeBaseFile('boq.xlsx')).toBe(false);
  });
});
