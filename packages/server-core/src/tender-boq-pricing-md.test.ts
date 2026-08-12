import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  publishBoqPricingArtifactsToOfficialOutputs,
  writeBoqPricingSummaryMarkdown,
} from './tender-boq-pricing-md.ts';
import type { TenderBoqBatchManifest } from './tender-boq-batches.ts';

describe('publishBoqPricingArtifactsToOfficialOutputs', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('copies chapter MD and resource schedule into parent Official Outputs', () => {
    root = mkdtempSync(join(tmpdir(), 'boq-pricing-publish-'));
    const projectDir = join(root, 'Agent Pi Outputs', '573', 'boq-pricing');
    mkdirSync(projectDir, { recursive: true });
    const chapter = join(projectDir, 'boq-sch-a-001__roadworks.md');
    const schedule = join(projectDir, '施工资源消耗总表.md');
    writeFileSync(chapter, '# SCH A\n\nFive-step workpaper.\n', 'utf8');
    writeFileSync(schedule, '# 施工资源消耗总表\n\n| labour | crew |\n', 'utf8');

    const manifest = {
      projectId: '573',
      batches: [
        { status: 'complete', markdownPath: chapter, source: { sheet: 'SCH A' } },
        { status: 'invalid', markdownPath: join(projectDir, 'missing.md'), source: { sheet: 'SCH B' } },
      ],
    } as unknown as TenderBoqBatchManifest;

    const result = publishBoqPricingArtifactsToOfficialOutputs(root, '260811-fair-moon', manifest, '573');
    expect(result.published).toBe(2);
    const publishedChapter = join(result.directory, 'boq-sch-a-001__roadworks.md');
    const publishedSchedule = join(result.directory, '施工资源消耗总表.md');
    expect(readFileSync(publishedChapter, 'utf8')).toContain('# SCH A');
    expect(readFileSync(publishedSchedule, 'utf8')).toContain('施工资源消耗总表');

    const again = publishBoqPricingArtifactsToOfficialOutputs(root, '260811-fair-moon', manifest, '573');
    expect(again.published).toBe(0);
  });

  test('writes a stage completion summary under the parent session', () => {
    root = mkdtempSync(join(tmpdir(), 'boq-pricing-summary-'));
    const summaryPath = writeBoqPricingSummaryMarkdown(
      {
        currency: 'ZAR',
        pricingStandard: 'c51_pure_direct_cost_v1',
        vatTreatment: 'exclusive',
        pricingStatus: 'draft',
        itemBuildUps: [{
          boqItemId: 'item-1',
          status: 'reviewed',
          directCost: '10',
          directCostSummary: { itemDirectCost: '10' },
          costComponents: [{ assumptionStatus: 'unverified' }],
        } as never],
        resourceSummary: [],
        assumptions: [],
      },
      {
        projectId: '573',
        parentSessionId: '260811-fair-moon',
        workingDirectory: root,
        manifest: {
          batchCount: 1,
          batches: [{
            status: 'complete',
            markdownPath: join(root, 'chapter.md'),
            source: { sheet: 'SCH A' },
            batchId: 'batch-1',
          }],
        } as unknown as TenderBoqBatchManifest,
        resourceScheduleRowCount: 12,
        resourceScheduleMarkdownPath: join(root, 'Agent Pi Outputs', '260811-fair-moon', 'boq-pricing', '施工资源消耗总表.md'),
        reviewItems: ['resource unit conflict for labour 普工: a uses 工日, b uses day'],
      },
    );
    const markdown = readFileSync(summaryPath, 'utf8');
    expect(summaryPath).toContain(join('Agent Pi Outputs', '260811-fair-moon', 'boq-pricing-summary.md'));
    expect(markdown).toContain('# 组价阶段完成纪要');
    expect(markdown).toContain('ZAR 10.00');
    expect(markdown).toContain('人材机总表');
    expect(markdown).toContain('待复核');
    expect(markdown).toContain('SCH A');
  });
});
