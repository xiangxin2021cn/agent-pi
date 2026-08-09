import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeNamespacedDocumentAnalysisSectionId,
  mergeDocumentAnalysisBatchReports,
  validateDocumentAnalysisBatchMerge,
} from './document-analysis-merge.ts';

describe('document-analysis batch merge', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('namespaces duplicate template section ids per document', () => {
    expect(makeNamespacedDocumentAnalysisSectionId('book-1', 'sec-02-tender-requirements'))
      .toBe('book-1--sec-02-tender-requirements');
  });

  test('merges reports that reuse template section ids across documents', () => {
    root = mkdtempSync(join(tmpdir(), 'da-merge-'));
    const batches = ['doc-a', 'doc-b'].map((documentId, index) => {
      const reportPath = join(root, `${documentId}.json`);
      writeFileSync(reportPath, JSON.stringify({
        schemaVersion: 1,
        batchId: `batch-${index}`,
        documentId,
        sections: [{
          id: 'sec-01-project-information',
          kind: 'project_information',
          title: 'Project information',
          summary: `Summary ${documentId}`,
          sourceRefs: [{ documentId, page: 1 }],
          status: 'reviewed',
        }],
      }));
      return {
        batchId: `batch-${index}`,
        documentId,
        reportPath,
        status: 'complete' as const,
      };
    });

    const merged = mergeDocumentAnalysisBatchReports(batches);
    expect(merged.errors).toEqual([]);
    expect(merged.data.sections).toHaveLength(2);
    expect(merged.data.sections.map((section) => section.id)).toEqual([
      'doc-a--sec-01-project-information',
      'doc-b--sec-01-project-information',
    ]);
    expect(validateDocumentAnalysisBatchMerge(batches, merged.data)).toEqual([]);
  });
});
