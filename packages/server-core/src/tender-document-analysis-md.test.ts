import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatProjectCharacteristicsMarkdown,
  publishDocumentAnalysisArtifactsToOfficialOutputs,
} from './tender-document-analysis-md.ts';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';
import type { TenderDocumentAnalysisData } from '@agent-pi/business-core/tender';

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

describe('project characteristics markdown', () => {
  test('groups FIDIC, specs, duration, and leftover constraints into 项目特征 chapters', () => {
    const data: TenderDocumentAnalysisData = {
      sections: [
        {
          id: 's-contract',
          documentId: 'vol1',
          title: 'Particular Conditions',
          kind: 'special_conditions',
          summary: 'FIDIC Red Book 1999 with particular conditions amending Sub-Clause 4.4 subcontracting.',
          sourceRefs: [{ documentId: 'vol1', clause: '4.4' }],
          status: 'reviewed',
        },
        {
          id: 's-spec',
          documentId: 'vol2',
          title: 'Project Specification amendments',
          kind: 'tender_requirements',
          summary: 'COTO 2020 particular specification amends clause A5.3.',
          sourceRefs: [{ documentId: 'vol2', clause: 'A5.3' }],
          status: 'reviewed',
        },
        {
          id: 's-hours',
          documentId: 'vol1',
          title: 'Working hours',
          kind: 'tender_requirements',
          summary: 'Working hours 07:00–17:00; no work on public holidays.',
          sourceRefs: [],
          status: 'reviewed',
        },
        {
          id: 's-info',
          documentId: 'vol1',
          title: 'Site data',
          kind: 'project_information',
          summary: 'Site is near Windhoek. Time for completion is 24 months.',
          sourceRefs: [{ documentId: 'vol1', page: 12 }],
          status: 'reviewed',
        },
      ],
    };
    const markdown = formatProjectCharacteristicsMarkdown(data, {
      projectId: 'n3',
      parentSessionId: 'parent-1',
      workingDirectory: '/tmp',
      manifest: {
        schemaVersion: 1,
        projectId: 'n3',
        generatedAt: '2026-08-14T00:00:00.000Z',
        documentCount: 2,
        batchCount: 2,
        completedBatches: 2,
        missingDocumentIds: [],
        batches: [
          {
            batchId: 'b1',
            documentId: 'vol1',
            sourcePath: 'C:/inputs/Volume1.pdf',
            briefPath: '',
            reportPath: '',
            markdownPath: '',
            status: 'complete',
            validationErrors: [],
          },
          {
            batchId: 'b2',
            documentId: 'vol2',
            sourcePath: 'C:/inputs/Volume2.pdf',
            briefPath: '',
            reportPath: '',
            markdownPath: '',
            status: 'complete',
            validationErrors: [],
          },
        ],
        manifestPath: '',
      },
    });
    expect(markdown).toContain('# 项目特征');
    expect(markdown).toContain('合同制式与专用条款');
    expect(markdown).toContain('FIDIC');
    expect(markdown).toContain('技术规范与条文修订');
    expect(markdown).toContain('COTO');
    expect(markdown).toContain('工作时间与节假日');
    expect(markdown).toContain('public holidays');
    expect(markdown).toContain('工期、地点与自然条件');
    expect(markdown).toContain('Windhoek');
    expect(markdown).toContain('## 证据与缺口');
    expect(markdown).toContain('不得用模型记忆填空');
  });
});
