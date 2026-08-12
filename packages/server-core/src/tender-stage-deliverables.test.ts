import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildStageDeliverablesCatalog,
  organizeStageDeliverables,
} from './tender-stage-deliverables.ts';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';

describe('tender stage deliverables', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('organizes analysis MD into Official Outputs and writes catalog', () => {
    root = mkdtempSync(join(tmpdir(), 'stage-deliverables-'));
    const projectRoot = root;
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', '573');
    const analysisDir = join(projectRoot, 'Agent Pi Outputs', '573', 'document-analysis');
    mkdirSync(analysisDir, { recursive: true });
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    const mdPath = join(analysisDir, 'document-a__book.md');
    writeFileSync(mdPath, '# Book\n\nUseful analysis summary for pricing.\n', 'utf8');
    writeFileSync(
      join(projectDirectory, 'packs', 'document-analysis.json'),
      JSON.stringify({
        schemaVersion: 1,
        capability: 'document_analysis',
        revision: 1,
        data: { sections: [{ id: 's1', kind: 'other', title: 'T', summary: 'ok', sourceRefs: [], status: 'draft', documentId: 'document-a' }] },
      }),
      'utf8',
    );

    const manifest = {
      batches: [{
        batchId: 'document-aaa',
        documentId: 'document-a',
        markdownPath: mdPath,
        status: 'complete',
        validationErrors: [],
      }],
    } as unknown as TenderDocumentAnalysisBatchManifest;

    const result = organizeStageDeliverables({
      projectRoot,
      projectId: '573',
      projectDirectory,
      stageId: 'tender-document-analysis',
      parentSessionId: '260811-fair-moon',
      documentManifest: manifest,
    });

    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(result.catalog.catalogPath).toContain('stage-deliverables-tender-document-analysis.json');
    const published = join(projectRoot, 'Agent Pi Outputs', '260811-fair-moon', 'document-analysis', 'document-a__book.md');
    expect(readFileSync(published, 'utf8')).toContain('# Book');
    expect(existsCatalog(result.catalog.catalogPath)).toBe(true);
    expect(result.catalog.items.some((item) => item.id === 'md:document-a')).toBe(true);

    const rebuilt = buildStageDeliverablesCatalog({
      projectRoot,
      projectId: '573',
      projectDirectory,
      stageId: 'tender-document-analysis',
      parentSessionId: '260811-fair-moon',
      documentManifest: manifest,
    });
    expect(rebuilt.indexLines.some((line) => line.includes('document-a__book.md'))).toBe(true);
  });
});

function existsCatalog(path: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed.schemaVersion === 1;
  } catch {
    return false;
  }
}
