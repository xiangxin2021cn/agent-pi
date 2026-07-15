import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditKnowledgeBaseCitations,
  listKnowledgeBaseSources,
  readKnowledgeBaseChunk,
  readKnowledgeBaseRange,
  searchKnowledgeBase,
} from './knowledge-base-index.ts';

describe('knowledge base index', () => {
  test('searches registered file-memory manifests and reads cited chunks without loading full documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-index-'));
    try {
      const workspace = join(root, 'workspace');
      const kbRoot = join(root, 'config');
      const sourceDir = join(workspace, 'file-memory', 'file-memory-coto');
      mkdirSync(sourceDir, { recursive: true });
      mkdirSync(join(kbRoot, 'knowledge-base'), { recursive: true });

      const sourceFile = join(root, 'COTO.md');
      writeFileSync(sourceFile, [
        '# Chapter 1 General',
        'Clause 1101 requires the contractor to comply with the engineer instructions.',
        'Slotted drain cover acceptance depends on visible cracks and exposed reinforcement.',
        'Final unrelated line.',
      ].join('\n'));

      const manifestPath = join(sourceDir, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify({
        version: 1,
        displayName: 'COTO Book 1',
        sourceFile,
        chunks: [
          {
            id: 'chunk-0001',
            title: 'Chapter 1 General',
            text: 'Clause 1101 requires the contractor to comply with the engineer instructions.\nSlotted drain cover acceptance depends on visible cracks and exposed reinforcement.',
            startLine: 2,
            endLine: 3,
            metadata: {
              headingPath: ['Chapter 1 General'],
              clauseRefs: ['1101'],
              tableRefs: [],
            },
          },
        ],
      }, null, 2));

      writeFileSync(join(kbRoot, 'knowledge-base', 'registry.json'), JSON.stringify({
        version: 1,
        entries: [
          {
            sourceSlug: 'file-memory-coto',
            name: 'COTO Book 1',
            sourceFilePath: sourceFile,
            manifestPath,
            workspacePath: workspace,
            knowledgeCategory: 'COTO',
            knowledgeFolder: 'COTO',
            scope: 'global',
            sourceKind: 'file-memory',
            fileExtension: '.md',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }, null, 2));

      expect(listKnowledgeBaseSources(kbRoot).map(source => source.sourceSlug)).toEqual(['file-memory-coto']);

      const results = searchKnowledgeBase(kbRoot, { query: 'slotted drain exposed reinforcement', limit: 5 });
      expect(results.indexStrategy).toBe('local-inverted-index');
      expect(results.results).toHaveLength(1);
      expect(results.results[0]?.sourceSlug).toBe('file-memory-coto');
      expect(results.results[0]?.chunk.id).toBe('chunk-0001');

      const chunk = readKnowledgeBaseChunk(kbRoot, 'file-memory-coto', 'chunk-0001');
      expect(chunk?.text).toContain('visible cracks');

      const range = readKnowledgeBaseRange(kbRoot, 'file-memory-coto', { startLine: 2, endLine: 3 });
      expect(range?.text).toContain('Clause 1101');

      const audit = auditKnowledgeBaseCitations(kbRoot, {
        citations: [{ sourceSlug: 'file-memory-coto', chunkId: 'chunk-0001' }],
        requiredSourceSlugs: ['file-memory-coto'],
      });
      expect(audit.passed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
