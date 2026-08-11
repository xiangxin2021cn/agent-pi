import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  parseTenderBoqFiveStepPricingDataLenient,
  parseTenderCapabilityEnvelope,
  type TenderBoqFiveStepPricingData,
  type TenderConstructionResourceScheduleData,
  type TenderConstructionResourceRow,
} from '@agent-pi/business-core/tender';

function coerceEntityId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'resource';
}

function addQty(left: string, right: string): string {
  const sum = Number(left) + Number(right);
  if (!Number.isFinite(sum)) return left;
  return String(Number(sum.toFixed(6)));
}

export function aggregateConstructionResourceSchedule(
  pricing: TenderBoqFiveStepPricingData,
): TenderConstructionResourceScheduleData {
  const byKey = new Map<string, TenderConstructionResourceRow>();
  for (const item of pricing.itemBuildUps) {
    const quantityText = item.itemIdentity?.quantity
      ?? item.directCostSummary?.boqQuantity
      ?? '1';
    const boqQty = Number(quantityText);
    for (const consumption of item.resourceConsumptions ?? []) {
      const perUnit = Number(consumption.quantity);
      if (!Number.isFinite(perUnit) || !Number.isFinite(boqQty)) continue;
      const total = String(Number((perUnit * boqQty).toFixed(6)));
      const key = `${consumption.kind}::${consumption.description}::${consumption.unit}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.totalQuantity = addQty(existing.totalQuantity, total);
        if (!existing.sourceBoqItemIds.includes(item.boqItemId)) {
          existing.sourceBoqItemIds.push(item.boqItemId);
        }
        if (consumption.assumptionStatus === 'unverified') existing.assumptionStatus = 'unverified';
        continue;
      }
      const matchingComponent = item.costComponents.find(
        (component) => component.id === consumption.costComponentId || component.description === consumption.description,
      );
      byKey.set(key, {
        id: coerceEntityId(`${consumption.kind}-${consumption.description}`),
        category: consumption.kind,
        name: consumption.description,
        unit: consumption.unit,
        totalQuantity: total,
        ...(matchingComponent?.rate ? { unitRate: matchingComponent.rate } : {}),
        ...(pricing.currency ? { currency: pricing.currency } : {}),
        sourceBoqItemIds: [item.boqItemId],
        assumptionStatus: consumption.assumptionStatus,
        sourceRefs: consumption.sourceRefs ?? [],
      });
    }
  }
  return {
    ...(pricing.currency ? { currency: pricing.currency } : {}),
    rows: [...byKey.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    notes: ['Aggregated from BOQ five-step resourceConsumptions × BOQ quantities.'],
  };
}

export function resourceScheduleArtifactPaths(projectRoot: string, projectId: string): {
  markdownPath: string;
  jsonPath: string;
} {
  const directory = join(projectRoot, 'Agent Pi Outputs', projectId, 'boq-pricing');
  return {
    markdownPath: join(directory, '施工资源消耗总表.md'),
    jsonPath: join(directory, '施工资源消耗总表.json'),
  };
}

export function writeConstructionResourceScheduleArtifacts(options: {
  projectRoot: string;
  projectId: string;
  pricingPackPath: string;
}): { data: TenderConstructionResourceScheduleData; markdownPath: string; jsonPath: string } | { errors: string[] } {
  if (!existsSync(options.pricingPackPath)) {
    return { errors: ['boq_five_step_pricing pack missing'] };
  }
  try {
    const envelope = parseTenderCapabilityEnvelope(JSON.parse(readFileSync(options.pricingPackPath, 'utf8')));
    const pricing = parseTenderBoqFiveStepPricingDataLenient(envelope.data).data;
    const data = aggregateConstructionResourceSchedule(pricing);
    if (data.rows.length === 0) {
      return { errors: ['no-rows'] };
    }
    const artifacts = resourceScheduleArtifactPaths(options.projectRoot, options.projectId);
    mkdirSync(dirname(artifacts.markdownPath), { recursive: true });
    writeFileSync(artifacts.jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    writeFileSync(artifacts.markdownPath, renderResourceScheduleMarkdown(data), 'utf8');
    return { data, markdownPath: artifacts.markdownPath, jsonPath: artifacts.jsonPath };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function assertResourceScheduleArtifacts(
  projectRoot: string,
  projectId: string,
  projectDirectory: string,
): string[] {
  const artifacts = resourceScheduleArtifactPaths(projectRoot, projectId);
  const missing: string[] = [];
  if (!existsSync(artifacts.markdownPath)) missing.push('resource-schedule:missing-md');
  if (!existsSync(join(projectDirectory, 'packs', 'construction-resource-schedule.json'))) {
    missing.push('resource-schedule:missing-pack');
  }
  return missing;
}

function renderResourceScheduleMarkdown(data: TenderConstructionResourceScheduleData): string {
  const lines = [
    '# 施工资源消耗总表',
    '',
    data.currency ? `币种：${data.currency}` : '',
    '',
    '| 类别 | 品名 | 单位 | 总量 | 单价 | 假设状态 | 来源 BOQ 项 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ].filter(Boolean);
  for (const row of data.rows) {
    lines.push(
      `| ${row.category} | ${row.name} | ${row.unit} | ${row.totalQuantity} | ${row.unitRate ?? '—'} | ${row.assumptionStatus} | ${row.sourceBoqItemIds.join(', ')} |`,
    );
  }
  lines.push('', '## Notes', '');
  for (const note of data.notes ?? []) lines.push(`- ${note}`);
  lines.push('');
  return lines.join('\n');
}
