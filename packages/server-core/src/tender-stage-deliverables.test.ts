import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildStageDeliverablesCatalog,
  organizeStageDeliverables,
} from './tender-stage-deliverables.ts';
import type { TenderDocumentAnalysisBatchManifest } from './tender-document-batches.ts';
import type { TenderBoqBatchManifest } from './tender-boq-batches.ts';

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
        projectId: '573',
        revision: 1,
        coreRevision: 1,
        upstream: [{ capability: 'core', revision: 1 }],
        updatedAt: '2026-08-14T00:00:00.000Z',
        data: {
          sections: [{
            id: 's1',
            kind: 'special_conditions',
            title: 'FIDIC Red Book particular conditions',
            summary: 'Employer amends Sub-Clause 8.2 time for completion.',
            sourceRefs: [{ documentId: 'document-a', clause: '8.2' }],
            status: 'reviewed',
            documentId: 'document-a',
          }],
        },
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
    expect(result.catalog.items.some((item) => item.id === 'md:project_characteristics' && item.presence === 'present')).toBe(true);
    expect(result.catalog.items.some((item) => item.id === 'json:project_characteristics_evidence')).toBe(true);
    const characteristicsPath = join(projectRoot, 'Agent Pi Outputs', '260811-fair-moon', '项目特征.md');
    expect(readFileSync(characteristicsPath, 'utf8')).toContain('FIDIC');
    expect(readFileSync(characteristicsPath, 'utf8')).toContain('合同制式与专用条款');

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

  test('organizes BOQ chapter MD into parent Official Outputs', () => {
    root = mkdtempSync(join(tmpdir(), 'stage-deliverables-boq-'));
    const projectRoot = root;
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', '573');
    const projectBoqDir = join(projectRoot, 'Agent Pi Outputs', '573', 'boq-pricing');
    mkdirSync(projectBoqDir, { recursive: true });
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    const mdPath = join(projectBoqDir, 'boq-sch-a-001__roadworks.md');
    writeFileSync(mdPath, '# SCH A\n\nFive-step workpaper for review.\n', 'utf8');
    writeFileSync(join(projectBoqDir, '施工资源消耗总表.md'), '# 施工资源消耗总表\n\n| labour | crew |\n', 'utf8');
    writeFileSync(
      join(projectDirectory, 'packs', 'boq-five-step-pricing.json'),
      JSON.stringify({
        schemaVersion: 1,
        capability: 'boq_five_step_pricing',
        revision: 1,
        data: {
          currency: 'ZAR',
          pricingStatus: 'draft',
          itemBuildUps: [{ boqItemId: 'item-1', status: 'reviewed', directCost: '10', costComponents: [] }],
          resourceSummary: [],
          assumptions: [],
        },
      }),
      'utf8',
    );

    const manifest = {
      projectId: '573',
      batchCount: 1,
      batches: [{
        batchId: 'boq-sch-a-001',
        markdownPath: mdPath,
        status: 'complete',
        source: { sheet: 'SCH A' },
        validationErrors: [],
      }],
    } as unknown as TenderBoqBatchManifest;

    const result = organizeStageDeliverables({
      projectRoot,
      projectId: '573',
      projectDirectory,
      stageId: 'boq-five-step-pricing',
      parentSessionId: '260811-fair-moon',
      boqManifest: manifest,
    });

    expect(result.published).toBeGreaterThanOrEqual(1);
    const published = join(projectRoot, 'Agent Pi Outputs', '260811-fair-moon', 'boq-pricing', 'boq-sch-a-001__roadworks.md');
    expect(readFileSync(published, 'utf8')).toContain('# SCH A');
    expect(existsSync(join(projectRoot, 'Agent Pi Outputs', '260811-fair-moon', 'boq-pricing-summary.md'))).toBe(true);
    expect(result.catalog.items.some((item) => item.id === 'summary:boq_five_step_pricing')).toBe(true);
    expect(result.catalog.items.some((item) => item.id === 'md:construction_resource_schedule')).toBe(true);
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
