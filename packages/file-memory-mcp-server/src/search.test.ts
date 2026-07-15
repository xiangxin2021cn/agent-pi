import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatChunk,
  formatManifestSummary,
  formatSearchResults,
  loadManifestFromPath,
  readChunk,
  searchManifest,
} from './search.ts';

describe('file memory search', () => {
  test('loads a manifest, searches chunks, and formats citations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-memory-'));
    try {
      const manifestPath = join(dir, 'manifest.json');
      writeFileSync(
        join(dir, 'chunk-2.txt'),
        'The retention bond must remain valid until the certificate of completion is issued.'
      );
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 1,
            displayName: 'Tender Conditions',
            sourceFile: 'E:/project/tender.md',
            chunks: [
              {
                id: 'chunk-1',
                title: 'Eligibility',
                text: 'The tenderer must submit company registration and tax clearance.',
                page: 4,
                startLine: 10,
                endLine: 16,
              },
              {
                id: 'chunk-2',
                title: 'Retention Bond',
                textPath: 'chunk-2.txt',
                page: 11,
                startLine: 120,
                endLine: 124,
              },
            ],
          },
          null,
          2
        )
      );

      const manifest = loadManifestFromPath(manifestPath);
      expect(formatManifestSummary(manifest)).toContain('Chunks: 2');

      const results = searchManifest(manifest, 'retention bond', 5);
      expect(results).toHaveLength(1);
      expect(results[0]?.chunk.id).toBe('chunk-2');

      const formatted = formatSearchResults(manifest, 'retention bond', results);
      expect(formatted).toContain('E:/project/tender.md, page 11, lines 120-124');

      const chunk = readChunk(manifest, 'chunk-2');
      expect(chunk).not.toBeNull();
      expect(formatChunk(manifest, chunk!)).toContain('certificate of completion');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uses CJK n-gram terms so Chinese technical queries do not require exact full phrase matches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-memory-'));
    try {
      const manifestPath = join(dir, 'manifest.json');
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 1,
            displayName: 'COLTO Drain Cover',
            sourceFile: 'E:/project/standard.md',
            chunks: [
              {
                id: 'chunk-1',
                title: 'Slotted Drain Cover Acceptance',
                text: '排水沟盖板应检查外观质量、裂缝、钢筋外露和边角破损，并记录验收结论。',
                startLine: 1,
                endLine: 3,
              },
            ],
          },
          null,
          2
        )
      );

      const manifest = loadManifestFromPath(manifestPath);
      const results = searchManifest(manifest, '沟盖 外观 验收', 5);
      expect(results).toHaveLength(1);
      expect(results[0]?.chunk.id).toBe('chunk-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
