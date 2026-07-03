import type { ScheduleTask } from '@craft-agent/shared/document-visuals';

const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function normalizeScheduleTasks(input: string | unknown): ScheduleTask[] {
  if (typeof input === 'string') {
    const parsed = tryParseJson(input);
    if (parsed !== undefined) return normalizeScheduleTasks(parsed);
    return normalizeScheduleTasksFromMarkdown(input);
  }

  const records = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.tasks)
      ? input.tasks
      : [];

  return records
    .map((record, index) => normalizeScheduleTaskRecord(record, index))
    .filter((task): task is ScheduleTask => task !== null);
}

export function normalizeScheduleTasksFromMarkdown(markdown: string): ScheduleTask[] {
  const table = extractFirstMarkdownTable(markdown);
  if (table.length < 2) return [];

  const [headerRow, ...bodyRows] = table;
  if (!headerRow) return [];

  const headers = headerRow.map(normalizeHeader);

  return bodyRows
    .map((row, index): ScheduleTask | null => {
      const name = getCell(row, headers, ['task', 'activity', 'name', '任务', '工作内容']);
      if (!name) return null;

      return {
        id: getCell(row, headers, ['id']) || `task-${index + 1}`,
        name,
        wbs: getCell(row, headers, ['wbs']),
        baselineStart: normalizeDate(getCell(row, headers, ['baselinestart', 'plannedstart', 'baseline start'])),
        baselineFinish: normalizeDate(getCell(row, headers, ['baselinefinish', 'plannedfinish', 'baseline finish'])),
        start: normalizeDate(getCell(row, headers, ['currentstart', 'start', 'actualstart', 'current start'])),
        finish: normalizeDate(getCell(row, headers, ['currentfinish', 'finish', 'actualfinish', 'current finish'])),
        percentComplete: normalizePercent(getCell(row, headers, ['progress', 'progress%', 'percentcomplete', 'complete', '完成率'])),
        dependencies: normalizeDependencies(getCell(row, headers, ['dependencies', 'predecessors', 'logic', '前置任务'])),
        critical: normalizeBoolean(getCell(row, headers, ['critical', 'criticalpath', '关键路径'])),
        milestone: normalizeBoolean(getCell(row, headers, ['milestone', '里程碑'])),
      };
    })
    .filter((task): task is ScheduleTask => task !== null);
}

function normalizeScheduleTaskRecord(record: unknown, index: number): ScheduleTask | null {
  if (!isRecord(record)) return null;
  const name = getString(record, 'name') ?? getString(record, 'task') ?? getString(record, 'activity');
  if (!name) return null;

  return {
    id: getString(record, 'id') ?? `task-${index + 1}`,
    name,
    wbs: getString(record, 'wbs'),
    start: normalizeDate(getString(record, 'start') ?? getString(record, 'currentStart')),
    finish: normalizeDate(getString(record, 'finish') ?? getString(record, 'currentFinish')),
    baselineStart: normalizeDate(getString(record, 'baselineStart')),
    baselineFinish: normalizeDate(getString(record, 'baselineFinish')),
    percentComplete: normalizePercent(getString(record, 'percentComplete') ?? getString(record, 'progress')),
    dependencies: normalizeDependenciesFromUnknown(record.dependencies),
    critical: typeof record.critical === 'boolean' ? record.critical : normalizeBoolean(getString(record, 'critical')),
    milestone: typeof record.milestone === 'boolean' ? record.milestone : normalizeBoolean(getString(record, 'milestone')),
  };
}

function tryParseJson(input: string): unknown | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function extractFirstMarkdownTable(markdown: string): string[][] {
  const rows: string[][] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!isTableLine(line)) {
      if (rows.length > 0) break;
      continue;
    }

    if (!TABLE_SEPARATOR_PATTERN.test(line)) {
      rows.push(splitTableRow(line));
    }
  }
  return rows;
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5%]+/g, '');
}

function getCell(row: string[], headers: string[], names: string[]): string | undefined {
  const normalizedNames = names.map(normalizeHeader);
  const index = headers.findIndex(header => normalizedNames.includes(header));
  const value = index >= 0 ? row[index]?.trim() : undefined;
  return value || undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\b(20\d{2}|19\d{2})[-/.年](0?[1-9]|1[0-2])[-/.月](0?[1-9]|[12]\d|3[01])日?\b/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

function normalizePercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(?:yes|true|y|1|是|关键)$/i.test(value.trim())) return true;
  if (/^(?:no|false|n|0|否)$/i.test(value.trim())) return false;
  return undefined;
}

function normalizeDependencies(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const dependencies = value
    .split(/[;,，、]/)
    .map(item => item.trim())
    .filter(Boolean);
  return dependencies.length > 0 ? dependencies : undefined;
}

function normalizeDependenciesFromUnknown(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const dependencies = value.map(item => String(item).trim()).filter(Boolean);
    return dependencies.length > 0 ? dependencies : undefined;
  }
  return normalizeDependencies(typeof value === 'string' ? value : undefined);
}
