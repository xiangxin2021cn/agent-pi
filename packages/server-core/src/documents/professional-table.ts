import type { DocumentDomain, ProfessionalTableProfile } from '@craft-agent/shared/document-visuals';

export interface ProfessionalTableOptions {
  title?: string;
  domain?: DocumentDomain;
  sourceLabel?: string;
  rawSidecarPath?: string;
  maxDisplayColumns?: number;
}

export interface ProfessionalTableResult {
  markdown: string;
  profile: ProfessionalTableProfile & { hasNegativeValues: boolean };
  rawSidecar: {
    path?: string;
    rows: string[][];
  };
}

export function profileProfessionalTable(
  rows: string[][],
  options: Pick<ProfessionalTableOptions, 'domain' | 'title'> = {},
): ProfessionalTableProfile & { hasNegativeValues: boolean } {
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const dateColumns = headers.filter((header, index) => isDateColumn(header, body.map(row => row[index])));
  const unitColumns = headers.filter(header => /unit|单位/i.test(header));
  const numericColumns = headers.filter((header, index) =>
    !dateColumns.includes(header)
    && !unitColumns.includes(header)
    && body.some(row => isNumericCell(row[index]))
  );

  return {
    domain: options.domain ?? 'general',
    title: options.title,
    numericColumns,
    dateColumns,
    currencyColumns: headers.filter((header, index) =>
      numericColumns.includes(header)
      && (isCurrencyHeader(header) || body.some(row => /[$€£¥]|zar|usd|rmb|cny/i.test(row[index] ?? '')))
    ),
    unitColumns,
    hasTotals: body.some(row => row.some(cell => /total|subtotal|合计|小计/i.test(cell))),
    hasScenarioColumns: headers.some(header => /base|downside|upside|scenario|case|情景|敏感/i.test(header)),
    hasNegativeValues: body.some(row => row.some(cell => parseNumericCell(cell) < 0)),
  };
}

export function formatProfessionalTable(rows: string[][], options: ProfessionalTableOptions = {}): ProfessionalTableResult {
  const profile = profileProfessionalTable(rows, options);
  const headers = rows[0] ?? [];
  const maxColumns = options.maxDisplayColumns ?? headers.length;
  const displayHeaders = headers.slice(0, maxColumns);
  const displayRows = rows.slice(1).map(row => row.slice(0, maxColumns));
  const lines: string[] = [];

  if (options.title) {
    lines.push(`### ${options.title}`);
    lines.push('');
  }

  lines.push(formatMarkdownRow(displayHeaders));
  lines.push(formatMarkdownRow(displayHeaders.map(() => '---')));
  for (const row of displayRows) {
    lines.push(formatMarkdownRow(row.map((cell, index) => formatCell(cell, displayHeaders[index] ?? '', profile))));
  }

  const notes: string[] = [];
  if (headers.length > displayHeaders.length) {
    notes.push(`Appendix recommended: original table has ${headers.length} columns; displayed first ${displayHeaders.length} columns.`);
  }
  if (options.sourceLabel) {
    notes.push(`Source: ${options.sourceLabel}.`);
  }
  if (options.rawSidecarPath) {
    notes.push(`Raw table: \`${options.rawSidecarPath}\`.`);
  }

  if (notes.length > 0) {
    lines.push('');
    for (const note of notes) {
      lines.push(`> ${note}`);
    }
  }

  return {
    markdown: lines.join('\n'),
    profile,
    rawSidecar: {
      path: options.rawSidecarPath,
      rows,
    },
  };
}

function formatMarkdownRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownCell).join(' | ')} |`;
}

function formatCell(
  cell: string,
  header: string,
  profile: ProfessionalTableProfile & { hasNegativeValues: boolean },
): string {
  if (!profile.numericColumns.includes(header)) return cell;
  const value = parseNumericCell(cell);
  if (!Number.isFinite(value)) return cell;
  const formatted = formatNumber(value, header, profile.currencyColumns.includes(header));
  return value < 0 && profile.currencyColumns.includes(header)
    ? `(${formatted.replace('-', '')})`
    : formatted;
}

function formatNumber(value: number, header: string, isCurrency: boolean): string {
  const abs = Math.abs(value);
  const fractionDigits = shouldUseTwoDecimals(value, header, isCurrency) ? 2 : abs > 0 && abs < 1 ? 4 : 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function shouldUseTwoDecimals(value: number, header: string, isCurrency: boolean): boolean {
  if (/rate|unit price|单价/i.test(header)) return true;
  return !Number.isInteger(value) && (isCurrency || Math.abs(value) >= 1);
}

function isDateColumn(header: string, values: Array<string | undefined>): boolean {
  return /date|year|period|月|年|日期/i.test(header)
    || values.some(value => !!value && /^(?:19|20)\d{2}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?$/.test(value.trim()));
}

function isCurrencyHeader(header: string): boolean {
  return /usd|zar|rmb|cny|eur|gbp|\$|amount|revenue|opex|capex|cash\s*flow|rate|cost|金额|收入|成本|单价|合价/i.test(header);
}

function isNumericCell(value: string | undefined): boolean {
  return Number.isFinite(parseNumericCell(value));
}

function parseNumericCell(value: string | undefined): number {
  if (!value) return Number.NaN;
  const cleaned = value.replace(/[,$€£¥\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number.parseFloat(cleaned);
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll('|', '\\|');
}
