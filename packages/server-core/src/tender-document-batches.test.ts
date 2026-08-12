import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createOrRefreshDocumentAnalysisBatchManifest,
  mergeDocumentAnalysisBatchReports,
  validateDocumentAnalysisBatchMerge,
  type TenderDocumentAnalysisBatchBrief,
} from './tender-document-batches.ts';

function writeAcceptableMarkdown(path: string, title = 'Analysis'): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `# ${title}\n\n## 摘要\n\nCustomer-facing summary for review.\n`);
}

describe('tender document analysis batch manifest', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('creates one exact child brief per registered tender source with markdownPath', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
      { documentId: 'boq', path: 'C:/inputs/BOQ.xlsx', name: 'BOQ.xlsx', kind: 'boq', priority: 2 },
    ];
    const manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });

    expect(manifest.documentCount).toBe(2);
    expect(manifest.batchCount).toBe(2);
    expect(manifest.batches.map((batch) => batch.documentId)).toEqual(['tender-data', 'boq']);
    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8')) as TenderDocumentAnalysisBatchBrief;
    expect(brief.allowedSources).toEqual([{ documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf' }]);
    expect(brief.scope).toEqual({ documentId: 'tender-data', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 });
    expect(brief.spawnPolicy).toBe('forbidden');
    expect(brief.finalArtifactPolicy).toBe('report-and-markdown');
    expect(brief.markdownPath).toContain(join('Agent Pi Outputs', 'n3', 'document-analysis'));
    expect(manifest.batches[0]?.markdownPath).toBe(brief.markdownPath);
    expect(brief.projectIndustry).toBeTruthy();
    expect(brief.documentRole).toBe('tender_data');
    expect(brief.objective).toContain('professional bid team');
    expect(brief.objective).toContain('Do NOT center the report on filenames');
    expect(brief.writingContract).toContain('THIS tender');
    expect(brief.writingContract).toContain('综上所述');
  });

  test('accepts only schema-valid reports that cite the assigned document and include MD', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    let manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
    ], { projectRoot: root });
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

    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }], { projectRoot: root });
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
    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }], { projectRoot: root });
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.batches[0]?.validationErrors).toEqual([]);
    expect(manifest.batches[0]?.validationWarnings?.some((warning) => warning.includes('Markdown'))).toBe(true);

    writeAcceptableMarkdown(batch.markdownPath, 'Tender Data');
    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }], { projectRoot: root });

    expect(manifest.batches[0]?.status).toBe('complete');
    expect(manifest.completedBatches).toBe(1);
    expect(manifest.missingDocumentIds).toEqual([]);
  });

  test('rejects a final analysis pack that omits or changes a completed child section', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [{
      documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1,
    }];
    let manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
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
    writeAcceptableMarkdown(batch.markdownPath);
    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
    const section = {
      id: 'tender-data--requirements-1', documentId: batch.documentId, kind: 'tender_requirements', title: 'Requirements',
      summary: 'Exact requirement.', sourceRefs: [{ documentId: batch.documentId, page: 3 }], status: 'reviewed',
    };

    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [] })).toContain(
      'final document analysis pack has no sections',
    );
    // Soft gate: coverage by section id only — summary text drift does not hard-block.
    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [{ ...section, summary: 'Changed.' }] })).toEqual([]);
    expect(validateDocumentAnalysisBatchMerge(manifest, { sections: [section] })).toEqual([]);
  });

  test('deterministically merges complete batch reports into final pack data', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
      { documentId: 'boq', path: 'C:/inputs/BOQ.xlsx', name: 'BOQ.xlsx', kind: 'boq', priority: 2 },
    ];
    let manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
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
      writeAcceptableMarkdown(batch.markdownPath, batch.documentId);
    }
    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });

    const merged = mergeDocumentAnalysisBatchReports(manifest);
    expect(merged.errors).toEqual([]);
    expect(merged.data.sections.map((section) => section.id)).toEqual([
      'tender-data--sec-02-tender-requirements',
      'boq--sec-02-tender-requirements',
    ]);
    expect(validateDocumentAnalysisBatchMerge(manifest, merged.data)).toEqual([]);
  });

  test('skips rewriting unchanged briefs on repeated refresh', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [
      { documentId: 'tender-data', path: 'C:/inputs/Tender Data.pdf', name: 'Tender Data.pdf', kind: 'tender_data', priority: 1 },
    ];
    const first = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
    const briefPath = first.batches[0]!.briefPath;
    const before = readFileSync(briefPath, 'utf8');
    const mtimeBefore = Bun.file(briefPath).lastModified;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
    expect(readFileSync(briefPath, 'utf8')).toBe(before);
    expect(second.batches[0]?.batchId).toBe(first.batches[0]?.batchId);
    expect(Bun.file(briefPath).lastModified).toBe(mtimeBefore);
  });

  test('accepts locator/excerpt sourceRefs and heals quarantined reports', async () => {
    root = mkdtempSync(join(tmpdir(), 'tender-document-batches-'));
    const sources = [{
      documentId: 'src-hse-doc',
      path: 'C:/inputs/Health.pdf',
      name: 'Health.pdf',
      kind: 'other',
      priority: 1,
    }];
    let manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
    const batch = manifest.batches[0]!;
    const report = {
      schemaVersion: 1,
      batchId: batch.batchId,
      documentId: 'src-hse-doc',
      sections: [{
        id: 'pi-01',
        kind: 'project_information',
        title: 'Identity',
        summary: 'Project-specific OH&S specification for package B',
        sourceRefs: [{ locator: '封面页', excerpt: 'WORK PACKAGE B' }],
        status: 'reviewed',
      }],
    };
    // Simulate the old strict gate quarantining a usable report.
    const quarantined = `${batch.reportPath}.invalid.${Date.now()}`;
    writeFileSync(quarantined, JSON.stringify(report));
    writeAcceptableMarkdown(batch.markdownPath, 'HSE');

    manifest = await createOrRefreshDocumentAnalysisBatchManifest(root, 'n3', sources, { projectRoot: root });
    expect(manifest.batches[0]?.status).toBe('complete');
    expect(existsSync(batch.reportPath)).toBe(true);
    expect(manifest.completedBatches).toBe(1);
  });
});
