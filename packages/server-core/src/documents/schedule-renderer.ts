import type { ScheduleTask } from '@craft-agent/shared/document-visuals';

export interface ConstructionScheduleRenderOptions {
  pageSize?: 'A4' | 'A3';
  orientation?: 'landscape';
  progressDate?: string;
  maxTasks?: number;
  denseDependencyThreshold?: number;
}

export interface ConstructionScheduleRenderResult {
  svg: string;
  warnings: string[];
  renderedTaskCount: number;
  usedFallbackTable: boolean;
  markdownFallback?: string;
}

interface DatedTask extends ScheduleTask {
  start: string;
  finish: string;
}

const PAGE_SIZES = {
  A4: { width: 1123, height: 794 },
  A3: { width: 1587, height: 1123 },
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function renderConstructionScheduleSvg(
  tasks: ScheduleTask[],
  options: ConstructionScheduleRenderOptions = {},
): ConstructionScheduleRenderResult {
  const datedTasks = tasks.filter(hasCurrentDates);
  if (datedTasks.length === 0) {
    return fallbackTable(tasks, ['Insufficient schedule dates for Gantt rendering; returned a table fallback.']);
  }

  const pageSize = options.pageSize ?? 'A4';
  const page = PAGE_SIZES[pageSize];
  const maxTasks = options.maxTasks ?? 60;
  const renderedTasks = datedTasks.slice(0, maxTasks);
  const warnings: string[] = [];

  if (datedTasks.length > renderedTasks.length) {
    warnings.push(`Schedule has ${datedTasks.length} tasks; rendered first ${renderedTasks.length} tasks for report readability.`);
  }

  const dependencyCount = renderedTasks.reduce((total, task) => total + (task.dependencies?.length ?? 0), 0);
  if (dependencyCount > (options.denseDependencyThreshold ?? 120)) {
    warnings.push('Dependency network is too dense to draw cleanly; summarize dependencies in a table.');
  }

  const dates = collectScheduleDates(renderedTasks, options.progressDate);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / MS_PER_DAY));
  const left = 220;
  const right = 48;
  const top = 92;
  const rowHeight = 34;
  const chartWidth = page.width - left - right;
  const chartHeight = Math.min(page.height - top - 112, renderedTasks.length * rowHeight + 20);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" data-page-size="${pageSize}" data-orientation="${options.orientation ?? 'landscape'}">`,
    '<style>',
    '.title{font:700 24px Arial, sans-serif;fill:#111827}.axis{stroke:#d1d5db;stroke-width:1}.label{font:12px Arial, sans-serif;fill:#374151}.small{font:11px Arial, sans-serif;fill:#6b7280}',
    '.wbs-band{fill:#eef2ff}.baseline-bar{fill:#9ca3af;opacity:.75}.current-bar{fill:#2563eb}.current-bar.critical{fill:#dc2626}.progress-fill{fill:#16a34a;opacity:.5}.progress-line{stroke:#f59e0b;stroke-width:2;stroke-dasharray:5 4}.milestone-diamond{fill:#7c3aed;stroke:#4c1d95;stroke-width:1}.legend-box{fill:#fff;stroke:#d1d5db;stroke-width:1}',
    '</style>',
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text class="title" x="40" y="42">Construction Schedule Gantt</text>`,
    `<text class="small" x="40" y="64">WBS-aware baseline/current schedule view</text>`,
    `<line class="axis" x1="${left}" y1="${top - 24}" x2="${left + chartWidth}" y2="${top - 24}"/>`,
  ];

  appendWbsBands(parts, renderedTasks, left, top, page.width - left - right, rowHeight);
  appendDateTicks(parts, minDate, totalDays, left, top, chartWidth);

  renderedTasks.forEach((task, index) => {
    const y = top + index * rowHeight;
    parts.push(`<text class="label" x="40" y="${y + 20}">${escapeXml(task.wbs ? `${task.wbs} ${task.name}` : task.name)}</text>`);
    parts.push(`<line class="axis" x1="${left}" y1="${y + rowHeight}" x2="${left + chartWidth}" y2="${y + rowHeight}"/>`);

    if (task.baselineStart && task.baselineFinish) {
      appendBar(parts, 'baseline-bar', task.baselineStart, task.baselineFinish, minDate, totalDays, left, y + 8, chartWidth, 7);
    }

    if (task.milestone) {
      const x = dateToX(task.finish, minDate, totalDays, left, chartWidth);
      parts.push(`<polygon class="milestone-diamond" points="${x},${y + 17} ${x + 7},${y + 24} ${x},${y + 31} ${x - 7},${y + 24}"/>`);
    } else {
      const className = task.critical ? 'current-bar critical' : 'current-bar';
      appendBar(parts, className, task.start, task.finish, minDate, totalDays, left, y + 18, chartWidth, 10);
      if (typeof task.percentComplete === 'number' && task.percentComplete > 0) {
        appendProgressFill(parts, task, minDate, totalDays, left, y + 18, chartWidth);
      }
    }
  });

  if (options.progressDate) {
    const x = dateToX(options.progressDate, minDate, totalDays, left, chartWidth);
    parts.push(`<line class="progress-line" x1="${x}" y1="${top - 32}" x2="${x}" y2="${top + chartHeight}"/>`);
    parts.push(`<text class="small" x="${x + 6}" y="${top - 36}">Progress ${escapeXml(options.progressDate)}</text>`);
  }

  appendLegend(parts, page.width - 380, page.height - 86);
  parts.push('</svg>');

  return {
    svg: parts.join(''),
    warnings,
    renderedTaskCount: renderedTasks.length,
    usedFallbackTable: false,
  };
}

export async function renderConstructionSchedulePng(
  tasks: ScheduleTask[],
  options: ConstructionScheduleRenderOptions = {},
): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const result = renderConstructionScheduleSvg(tasks, options);
  return sharp(Buffer.from(result.svg)).png().toBuffer();
}

function hasCurrentDates(task: ScheduleTask): task is DatedTask {
  return isIsoDate(task.start) && isIsoDate(task.finish);
}

function collectScheduleDates(tasks: DatedTask[], progressDate: string | undefined): number[] {
  const values = tasks.flatMap(task => [
    task.start,
    task.finish,
    task.baselineStart,
    task.baselineFinish,
  ]).filter((value): value is string => isIsoDate(value));

  if (isIsoDate(progressDate)) values.push(progressDate);
  return values.map(value => new Date(`${value}T00:00:00Z`).getTime());
}

function appendWbsBands(parts: string[], tasks: DatedTask[], left: number, top: number, width: number, rowHeight: number): void {
  let currentWbs = '';
  let groupStart = 0;

  for (let index = 0; index <= tasks.length; index += 1) {
    const task = tasks[index];
    const wbs = task?.wbs ?? '';
    if (index === 0) currentWbs = wbs;
    if (index < tasks.length && wbs === currentWbs) continue;

    if (currentWbs) {
      const y = top + groupStart * rowHeight;
      const height = (index - groupStart) * rowHeight;
      parts.push(`<rect class="wbs-band" x="${left}" y="${y}" width="${width}" height="${height}"/>`);
      parts.push(`<text class="small" x="${left - 56}" y="${y + 20}">WBS ${escapeXml(currentWbs)}</text>`);
    }

    currentWbs = wbs;
    groupStart = index;
  }
}

function appendDateTicks(parts: string[], minDate: number, totalDays: number, left: number, top: number, chartWidth: number): void {
  const tickCount = 5;
  for (let index = 0; index <= tickCount; index += 1) {
    const x = left + Math.round((chartWidth * index) / tickCount);
    const date = new Date(minDate + (totalDays * MS_PER_DAY * index) / tickCount).toISOString().slice(0, 10);
    parts.push(`<line class="axis" x1="${x}" y1="${top - 30}" x2="${x}" y2="${top + 12}"/>`);
    parts.push(`<text class="small" x="${x - 28}" y="${top - 36}">${date}</text>`);
  }
}

function appendBar(
  parts: string[],
  className: string,
  start: string,
  finish: string,
  minDate: number,
  totalDays: number,
  left: number,
  y: number,
  chartWidth: number,
  height: number,
): void {
  const x1 = dateToX(start, minDate, totalDays, left, chartWidth);
  const x2 = dateToX(finish, minDate, totalDays, left, chartWidth);
  parts.push(`<rect class="${className}" x="${x1}" y="${y}" width="${Math.max(3, x2 - x1)}" height="${height}" rx="2"/>`);
}

function appendProgressFill(
  parts: string[],
  task: DatedTask,
  minDate: number,
  totalDays: number,
  left: number,
  y: number,
  chartWidth: number,
): void {
  const x1 = dateToX(task.start, minDate, totalDays, left, chartWidth);
  const x2 = dateToX(task.finish, minDate, totalDays, left, chartWidth);
  const progressWidth = Math.max(2, ((x2 - x1) * Math.min(100, Math.max(0, task.percentComplete ?? 0))) / 100);
  parts.push(`<rect class="progress-fill" x="${x1}" y="${y}" width="${progressWidth}" height="10" rx="2"/>`);
}

function appendLegend(parts: string[], x: number, y: number): void {
  parts.push(`<g aria-label="Construction schedule legend"><rect class="legend-box" x="${x}" y="${y}" width="340" height="58" rx="4"/>`);
  parts.push(`<text class="small" x="${x + 12}" y="${y + 18}">Construction schedule legend</text>`);
  parts.push(`<rect class="baseline-bar" x="${x + 12}" y="${y + 28}" width="34" height="8"/><text class="small" x="${x + 52}" y="${y + 36}">Baseline</text>`);
  parts.push(`<rect class="current-bar" x="${x + 122}" y="${y + 28}" width="34" height="8"/><text class="small" x="${x + 162}" y="${y + 36}">Current</text>`);
  parts.push(`<rect class="current-bar critical" x="${x + 226}" y="${y + 28}" width="34" height="8"/><text class="small" x="${x + 266}" y="${y + 36}">Critical</text></g>`);
}

function dateToX(date: string, minDate: number, totalDays: number, left: number, chartWidth: number): number {
  const value = new Date(`${date}T00:00:00Z`).getTime();
  return Math.round(left + ((value - minDate) / (totalDays * MS_PER_DAY)) * chartWidth);
}

function fallbackTable(tasks: ScheduleTask[], warnings: string[]): ConstructionScheduleRenderResult {
  const rows = [
    '| Task | Start | Finish |',
    '| --- | --- | --- |',
    ...tasks.map(task => `| ${escapeMarkdown(task.name)} | ${task.start ?? ''} | ${task.finish ?? ''} |`),
  ];

  return {
    svg: '',
    warnings,
    renderedTaskCount: 0,
    usedFallbackTable: true,
    markdownFallback: rows.join('\n'),
  };
}

function isIsoDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('|', '\\|');
}
