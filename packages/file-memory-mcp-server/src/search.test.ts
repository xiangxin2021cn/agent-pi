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
});
