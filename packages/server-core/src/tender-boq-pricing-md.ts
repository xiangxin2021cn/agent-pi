import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  parseTenderBoqFiveStepPricingDataLenient,
  parseTenderCapabilityEnvelope,
  type TenderBoqFiveStepPricingData,
} from '@agent-pi/business-core/tender';
import type { TenderBoqBatchManifest } from './tender-boq-batches.ts';
import {
  copyFileIfNewer,
  tenderOfficialOutputsDir,
} from './tender-official-outputs.ts';
import { resourceScheduleArtifactPaths } from './tender-resource-schedule.ts';

export interface BoqPricingMarkdownMeta {
  projectId: string;
  parentSessionId: string;
  workingDirectory: string;
  manifest: TenderBoqBatchManifest;
  resourceScheduleMarkdownPath?: string;
  resourceScheduleRowCount?: number;
  reviewItems?: string[];
  generatedAt?: string;
}

export interface PublishBoqPricingArtifactsResult {
  directory: string;
  published: number;
  skipped: number;
  summaryPath?: string;
}

function officialBoqPricingDirectory(workingDirectory: string, parentSessionId: string): string {
  return tenderOfficialOutputsDir(workingDirectory, parentSessionId, 'boq-pricing');
}

export function readBoqPricingPackData(projectDirectory: string): TenderBoqFiveStepPricingData | undefined {
  const packPath = join(projectDirectory, 'packs', 'boq-five-step-pricing.json');
  if (!existsSync(packPath)) return undefined;
  try {
    const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(packPath, 'utf8')));
    return parseTenderBoqFiveStepPricingDataLenient(envelope.data).data;
  } catch {
    return undefined;
  }
}

/**
 * Copy chapter workpapers + resource schedule into the parent session Official
 * Outputs tree when they were written elsewhere. Same-path copies are skipped.
 */
export function publishBoqPricingArtifactsToOfficialOutputs(
  workingDirectory: string,
  parentSessionId: string,
  manifest: TenderBoqBatchManifest,
  _projectId?: string,
): PublishBoqPricingArtifactsResult {
  const directory = officialBoqPricingDirectory(workingDirectory, parentSessionId);
  mkdirSync(directory, { recursive: true });
  let published = 0;
  let skipped = 0;

  for (const batch of manifest.batches) {
    if (batch.status !== 'complete') {
      skipped += 1;
      continue;
    }
    const sourcePath = batch.markdownPath;
    if (!sourcePath || !existsSync(sourcePath)) {
      skipped += 1;
      continue;
    }
    if (copyFileIfNewer(sourcePath, join(directory, basename(sourcePath)))) published += 1;
    else skipped += 1;
  }

  const scheduleNames = ['施工资源消耗总表.md', '施工资源消耗总表.json'];
  const scheduleDirs = new Set<string>([
    directory,
    ...manifest.batches.map((batch) => dirname(batch.markdownPath)).filter(Boolean),
  ]);
  for (const dir of scheduleDirs) {
    for (const name of scheduleNames) {
      const sourcePath = join(dir, name);
      if (!existsSync(sourcePath)) continue;
      if (copyFileIfNewer(sourcePath, join(directory, name))) published += 1;
      else skipped += 1;
    }
  }

  return { directory, published, skipped };
}

export function formatBoqPricingSummaryMarkdown(
  data: TenderBoqFiveStepPricingData,
  meta: BoqPricingMarkdownMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const items = data.itemBuildUps;
  const reviewed = items.filter((item) => item.status === 'reviewed').length;
  const draft = items.filter((item) => item.status === 'draft').length;
  const unverified = items.reduce((count, item) => (
    count + (item.costComponents ?? []).filter((component) => component.assumptionStatus === 'unverified').length
  ), 0);
  const directTotal = items.reduce((sum, item) => {
    const amount = Number(item.directCostSummary?.itemDirectCost ?? item.directCost ?? 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const completeBatches = meta.manifest.batches.filter((batch) => batch.status === 'complete').length;
  const currency = data.currency || '—';

  const lines: string[] = [
    '# 组价阶段完成纪要',
    '',
    `项目 \`${meta.projectId}\` · ${completeBatches}/${meta.manifest.batchCount} 批 · ${items.length} 项清单 · ${generatedAt.slice(0, 10)}`,
    '',
    '本稿供估价复核：覆盖与费用、人材机总表、分册底稿路径。逐章五步推导见同期发布的分册 Markdown。',
    '',
    '## 覆盖与状态',
    '',
    `| 项 | 值 |`,
    `| --- | --- |`,
    `| 批次 | ${completeBatches} / ${meta.manifest.batchCount} 完成 |`,
    `| 清单项 | ${items.length}（reviewed ${reviewed} · draft ${draft}） |`,
    `| 定价标准 | ${data.pricingStandard ?? '—'} · ${data.vatTreatment ?? 'exclusive'} |`,
    `| 纯直接费合计 | ${currency} ${directTotal.toFixed(2)} |`,
    `| 未核实费率分量 | ${unverified} |`,
    `| 人材机总表 | ${meta.resourceScheduleRowCount ?? 0} 行 |`,
    '',
  ];

  if (meta.resourceScheduleMarkdownPath) {
    lines.push(`人材机消耗总表：\`${meta.resourceScheduleMarkdownPath}\``);
    lines.push('');
  }

  const reviewItems = (meta.reviewItems ?? []).slice(0, 40);
  if (reviewItems.length > 0) {
    lines.push('## 待复核');
    lines.push('');
    lines.push('跨批次资源单位/费率不一致已记为复核项，不阻止查阅正式输出。');
    lines.push('');
    for (const item of reviewItems) lines.push(`- ${item}`);
    if ((meta.reviewItems?.length ?? 0) > reviewItems.length) {
      lines.push(`- …另有 ${(meta.reviewItems!.length - reviewItems.length)} 条同类复核项`);
    }
    lines.push('');
  }

  lines.push('## 分册底稿');
  lines.push('');
  for (const batch of meta.manifest.batches) {
    const name = basename(batch.markdownPath);
    const mark = batch.status === 'complete' ? '完成' : batch.status;
    lines.push(`- [${mark}] ${batch.source.sheet || batch.batchId} → ${name}`);
  }
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeBoqPricingSummaryMarkdown(
  data: TenderBoqFiveStepPricingData,
  meta: BoqPricingMarkdownMeta,
): string {
  const outputPath = join(
    tenderOfficialOutputsDir(meta.workingDirectory, meta.parentSessionId),
    'boq-pricing-summary.md',
  );
  const markdown = formatBoqPricingSummaryMarkdown(data, meta);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, markdown, 'utf8');
  renameSync(temporary, outputPath);
  return outputPath;
}

export function publishBoqPricingOfficialOutputs(input: {
  workingDirectory: string;
  projectId: string;
  projectDirectory: string;
  parentSessionId: string;
  manifest: TenderBoqBatchManifest;
  reviewItems?: string[];
}): PublishBoqPricingArtifactsResult {
  const published = publishBoqPricingArtifactsToOfficialOutputs(
    input.workingDirectory,
    input.parentSessionId,
    input.manifest,
  );
  const data = readBoqPricingPackData(input.projectDirectory) ?? {
    currency: 'USD',
    pricingStatus: 'draft' as const,
    itemBuildUps: [],
    resourceSummary: [],
    assumptions: [],
  };

  const schedule = resourceScheduleArtifactPaths(input.workingDirectory, input.parentSessionId);
  const officialSchedule = join(published.directory, '施工资源消耗总表.md');
  const summaryPath = writeBoqPricingSummaryMarkdown(data, {
    projectId: input.projectId,
    parentSessionId: input.parentSessionId,
    workingDirectory: input.workingDirectory,
    manifest: input.manifest,
    resourceScheduleMarkdownPath: existsSync(officialSchedule)
      ? officialSchedule
      : existsSync(schedule.markdownPath) ? schedule.markdownPath : undefined,
    resourceScheduleRowCount: existsSync(schedule.jsonPath)
      ? (() => {
        try {
          const parsed = JSON.parse(readFileSync(schedule.jsonPath, 'utf8')) as { rows?: unknown[] };
          return Array.isArray(parsed.rows) ? parsed.rows.length : 0;
        } catch {
          return 0;
        }
      })()
      : 0,
    reviewItems: input.reviewItems,
  });
  return { ...published, summaryPath };
}
