import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishDocumentAnalysisArtifactsToOfficialOutputs } from './tender-document-analysis-md.ts';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';

describe('publishDocumentAnalysisArtifactsToOfficialOutputs', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('copies completed analysis markdown into parent Official Outputs', () => {
    root = mkdtempSync(join(tmpdir(), 'doc-analysis-publish-'));
    const projectAnalysis = join(root, 'Agent Pi Outputs', '573', 'document-analysis');
    mkdirSync(projectAnalysis, { recursive: true });
    const sourceA = join(projectAnalysis, 'document-a__book.md');
    const sourceB = join(projectAnalysis, 'document-b__form.md');
    writeFileSync(sourceA, '# Book\n\nsummary\n', 'utf8');
    writeFileSync(sourceB, '# Form\n\nsummary\n', 'utf8');

    const manifest = {
      batches: [
        { status: 'complete', markdownPath: sourceA },
        { status: 'complete', markdownPath: sourceB },
        { status: 'invalid', markdownPath: join(projectAnalysis, 'missing.md') },
      ],
    } as unknown as TenderDocumentAnalysisBatchManifest;

    const result = publishDocumentAnalysisArtifactsToOfficialOutputs(root, '260811-fair-moon', manifest);
    expect(result.published).toBe(2);
    const publishedA = join(result.directory, 'document-a__book.md');
    const publishedB = join(result.directory, 'document-b__form.md');
    expect(readFileSync(publishedA, 'utf8')).toContain('# Book');
    expect(readFileSync(publishedB, 'utf8')).toContain('# Form');

    const again = publishDocumentAnalysisArtifactsToOfficialOutputs(root, '260811-fair-moon', manifest);
    expect(again.published).toBe(0);
  });
});
