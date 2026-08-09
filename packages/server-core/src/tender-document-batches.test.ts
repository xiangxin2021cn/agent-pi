import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOrRefreshDocumentAnalysisBatchManifest,
  mergeDocumentAnalysisBatchReports,
  validateDocumentAnalysisBatchMerge,
  type TenderDocumentAnalysisBatchBrief,
} from './tender-document-batches.ts';

describe('tender document analysis batch manifest', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('creates one exact child brief per registered tender source', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
      { documentId: 'boq', path: 'C:/inputs/BOQ.xlsx', name: 'BOQ.xlsx', kind: 'boq', priority: 2 },
    ];
    const manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources);

    expect(manifest.documentCount).toBe(2);
    expect(manifest.batchCount).toBe(2);
    expect(manifest.batches.map((batch) => batch.documentId)).toEqual(['tender-data', 'boq']);
    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderDocumentAnalysisBatchBrief;
    expect(brief.allowedSources).toEqual([{ documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf' }]);
    expect(brief.scope).toEqual({ documentId: 'tender-data', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 });
    expect(brief.spawnPolicy).toBe('forbidden');
    expect(brief.finalArtifactPolicy).toBe('report-only');
  });

  test('accepts only schema-valid reports that cite the assigned document', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    let manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
    ]);
    const batch = manifest.batches[0]!;
    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      documentId: 'tender-data',
      sections: [{
        id: 's1', kind: 'tender_requirements', title: 'Requirements', summary: 'Summary',
        sourceRefs: [{ documentId: 'other-document', page: 3 }], status: 'reviewed',
      }],
    }));

    manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }]);
    expect(manifest.batches[0]?.status).toBe('invalid');

    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      documentId: 'tender-data',
      sections: [{
        id: 's1', kind: 'tender_requirements', title: 'Requirements', summary: 'Summary',
        sourceRefs: [{ documentId: 'tender-data', page: 3 }], status: 'reviewed',
      }],
    }));
    manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }]);

    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.completedBatches).toBe(1);
    expect(manifest.missingDocumentIds).toEqual([]);
  });

  test('rejects a final analysis pack that omits or changes a completed child section', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }];
    let manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources);
    const batch = manifest.batches[0]!;
    writeFileSync(batch.reportPath, JSON.stringify({
      schemaVersion: 1,
      batchId: batch.batchId,
      documentId: batch.documentId,
      sections: [{
        id: 'requirements-1', kind: 'tender_requirements', title: 'Requirements', summary: 'Exact requirement.',
        sourceRefs: [{ documentId: batch.documentId, page: 3 }], status: 'reviewed',
      }],
    }));
    manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources);
    const section = {
      id: 'tender-data--requirements-1', documentId: batch.documentId, kind: 'tender_requirements', title: 'Requirements',
      summary: 'Exact requirement.', sourceRefs: [{ documentId: batch.documentId, page: 3 }], status: 'reviewed',
    };

    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [] })).toContain(
      'missing final document section: tender-data--requirements-1',
    );
    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [{ ...section, summary: 'Changed.' }] })).toContain(
      'final document section differs from merged batch report: tender-data--requirements-1',
    );
    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [section] })).toEqual([]);
  });

  test('deterministically merges complete batch reports into final pack data', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
      { documentId: 'boq', path: 'C:/inputs/BOQ.xlsx', name: 'BOQ.xlsx', kind: 'boq', priority: 2 },
    ];
    let manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources);
    for (const batch of manifest.batches) {
      writeFileSync(batch.reportPath, JSON.stringify({
        schemaVersion: 1,
        batchId: batch.batchId,
        documentId: batch.documentId,
        sections: [{
          // Intentionally reuse the same template id across documents.
          id: 'sec-02-tender-requirements',
          kind: 'tender_requirements',
          title: `${batch.documentId} requirements`,
          summary: `Summary for ${batch.documentId}`,
          sourceRefs: [{ documentId: batch.documentId, page: 1 }],
          status: 'reviewed',
        }],
      }));
    }
    manifest = createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources);

    const merged = mergeDocumentAnalysisBatchReports(manifest);
    expect(merged.errors).toEqual([]);
    expect(merged.data.sections.map((section) => section.id)).toEqual([
      'tender-data--sec-02-tender-requirements',
      'boq--sec-02-tender-requirements',
    ]);
    expect(validateDocumentAnalysisBatchMerge(manifest, merged.data)).toEqual([]);
  });
});
