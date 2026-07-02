import { describe, expect, test } from 'bun:test';
import type { LoadedSource } from './types.ts';
import {
  ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY,
  getEnterpriseKnowledgeCategory,
  isEnterpriseKnowledgeSource,
  isSupportedEnterpriseKnowledgeFile,
} from './enterprise-knowledge.ts';

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

describe('enterprise knowledge source metadata', () => {
  test('identifies enterprise knowledge sources without changing the source type', () => {
    const source = sourceWithMetadata({
      category: ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY,
      knowledgeCategory: 'Tender Standards',
      scope: 'global',
    });

    expect(source.config.type).toBe('mcp');
    expect(isEnterpriseKnowledgeSource(source)).toBe(true);
    expect(getEnterpriseKnowledgeCategory(source)).toBe('Tender Standards');
  });

  test('does not treat ordinary MCP sources as enterprise knowledge', () => {
    const source = sourceWithMetadata(undefined);

    expect(isEnterpriseKnowledgeSource(source)).toBe(false);
    expect(getEnterpriseKnowledgeCategory(source)).toBeNull();
  });

  test('only supports text-like MVP file formats', () => {
    expect(isSupportedEnterpriseKnowledgeFile('report.md')).toBe(true);
    expect(isSupportedEnterpriseKnowledgeFile('notes.TXT')).toBe(true);
    expect(isSupportedEnterpriseKnowledgeFile('manifest.json')).toBe(true);
    expect(isSupportedEnterpriseKnowledgeFile('drawing.pdf')).toBe(false);
    expect(isSupportedEnterpriseKnowledgeFile('boq.xlsx')).toBe(false);
  });
});
