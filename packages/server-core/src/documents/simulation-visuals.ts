import type { SimulationResultProfile } from '@craft-agent/shared/document-visuals';

export interface SimulationMetadata {
  solver?: string;
  source?: string;
  coordinateSystem?: string;
  timestep?: string;
  resultComponent?: string;
  loadCase?: string;
}

export interface SimulationNormalizeResult {
  profile?: SimulationResultProfile;
  rows: string[][];
  headers: string[];
  loadCases: string[];
  warnings: string[];
  strongClaimsAllowed: boolean;
}

export interface SimulationVisualAsset {
  kind: 'convergence' | 'time-history' | 'result-summary';
  svg: string;
}

export interface SimulationVisualResult extends SimulationNormalizeResult {
  markdown: string;
  assets: SimulationVisualAsset[];
}

export interface SimulationScreenshotReferenceInput {
  imagePath: string;
  caption: string;
  source?: string;
}

export function normalizeSimulationResults(input: string, metadata: SimulationMetadata = {}): SimulationNormalizeResult {
  if (isUnsupportedNativeResult(input)) {
    return {
      rows: [],
      headers: [],
      loadCases: [],
      warnings: ['Unsupported proprietary simulation result file; parser support is required before interpretation.'],
      strongClaimsAllowed: false,
    };
  }

  const rows = parseCsv(input);
  const [headers = [], ...body] = rows;
  if (headers.length === 0 || body.length === 0) {
    return {
      rows,
      headers,
      loadCases: [],
      warnings: ['No structured simulation result table was detected.'],
      strongClaimsAllowed: false,
    };
  }

  const resultTypes = detectResultTypes(headers);
  const units = detectUnits(headers);
  const loadCases = detectLoadCases(headers, body, metadata.loadCase);
  const warnings = validateMetadata(metadata, units, loadCases, resultTypes);

  return {
    profile: {
      solver: metadata.solver,
      resultTypes,
      numericSeries: headers.filter((header, index) => body.some(row => isNumeric(row[index]))),
      imageRefs: [],
      units,
    },
    rows,
    headers,
    loadCases,
    warnings,
    strongClaimsAllowed: warnings.length === 0,
  };
}

export function renderSimulationVisuals(input: string, metadata: SimulationMetadata = {}): SimulationVisualResult {
  const normalized = normalizeSimulationResults(input, metadata);
  const assets: SimulationVisualAsset[] = [];

  if (normalized.profile) {
    if (normalized.profile.resultTypes.includes('Residual')) {
      assets.push({ kind: 'convergence', svg: renderLineSvg('Residual convergence', normalized.rows, normalized.headers, 'Residual') });
    }
    if (normalized.headers.some(header => /time/i.test(header)) && normalized.profile.numericSeries.length > 1) {
      assets.push({ kind: 'time-history', svg: renderLineSvg('Time-history response', normalized.rows, normalized.headers, normalized.profile.numericSeries.at(-1) ?? '') });
    }
    assets.push({ kind: 'result-summary', svg: renderSummarySvg(normalized.profile, normalized.loadCases) });
  }

  const markdown = normalized.profile
    ? [
        '### Simulation Result Visuals',
        '',
        `- Solver: ${metadata.solver ?? 'unknown'}`,
        `- Source: ${metadata.source ?? 'unknown'}`,
        `- Load case: ${metadata.loadCase ?? (normalized.loadCases.join(', ') || 'unknown')}`,
        `- Coordinate system: ${metadata.coordinateSystem ?? 'unknown'}`,
        `- Timestep/frequency: ${metadata.timestep ?? 'unknown'}`,
        '',
        ...assets.map(asset => `![${asset.kind}](generated/${asset.kind}.svg)`),
      ].join('\n')
    : '';

  return {
    ...normalized,
    markdown,
    assets,
  };
}

export function renderSimulationScreenshotReference(input: SimulationScreenshotReferenceInput): { markdown: string; warnings: string[] } {
  if (!input.source) {
    return {
      markdown: '',
      warnings: ['Screenshot provenance is missing; image was not inserted.'],
    };
  }

  return {
    markdown: [
      `![${input.caption}](${input.imagePath})`,
      '',
      `> Evidence note: ${input.source}.`,
    ].join('\n'),
    warnings: [],
  };
}

function parseCsv(input: string): string[][] {
  return input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(',').map(cell => cell.trim()));
}

function detectResultTypes(headers: string[]): string[] {
  const joined = headers.join(' ');
  const resultTypes: string[] = [];
  if (/residual|convergence/i.test(joined)) resultTypes.push('Residual');
  if (/stress|应力/i.test(joined)) resultTypes.push('Stress');
  if (/displacement|位移/i.test(joined)) resultTypes.push('Displacement');
  if (/strain|应变/i.test(joined)) resultTypes.push('Strain');
  return resultTypes;
}

function detectUnits(headers: string[]): string[] {
  const units = new Set<string>();
  for (const header of headers) {
    const match = header.match(/\b(s|ms|MPa|kPa|Pa|mm|m|Hz|N|kN)\b/);
    if (match?.[1]) units.add(match[1]);
  }
  return [...units];
}

function detectLoadCases(headers: string[], rows: string[][], explicitLoadCase: string | undefined): string[] {
  if (explicitLoadCase) return [explicitLoadCase];
  const index = headers.findIndex(header => /load\s*case|loadcase|case/i.test(header));
  if (index < 0) return [];
  return [...new Set(rows.map(row => row[index]).filter((value): value is string => !!value))];
}

function validateMetadata(metadata: SimulationMetadata, units: string[], loadCases: string[], resultTypes: string[]): string[] {
  const warnings: string[] = [];
  if (!metadata.solver) warnings.push('Missing solver; strong result claims are disabled.');
  if (!metadata.source) warnings.push('Missing source; strong result claims are disabled.');
  if (loadCases.length === 0) warnings.push('Missing load case; result context is incomplete.');
  if (resultTypes.length === 0) warnings.push('Missing result component; strong engineering claims are disabled.');
  if (units.length === 0) warnings.push('Missing units; quantitative result claims are disabled.');
  if (!metadata.coordinateSystem) warnings.push('Missing coordinate system; strong spatial result claims are disabled.');
  if (!metadata.timestep) warnings.push('Missing timestep/frequency; time-history claims are limited.');
  return warnings;
}

function renderLineSvg(title: string, rows: string[][], headers: string[], seriesHeader: string): string {
  const index = headers.findIndex(header => header === seriesHeader);
  const values = rows.slice(1).map(row => Number.parseFloat(row[index] ?? '')).filter(Number.isFinite);
  const max = Math.max(...values, 1);
  const points = values.map((value, idx) => `${60 + idx * 80},${160 - (value / max) * 110}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220" viewBox="0 0 420 220"><text x="24" y="30" font-family="Arial" font-size="18" font-weight="700">${escapeXml(title)}</text><polyline fill="none" stroke="#2563eb" stroke-width="3" points="${points}"/><text x="24" y="198" font-family="Arial" font-size="11">Generated from exported simulation table.</text></svg>`;
}

function renderSummarySvg(profile: SimulationResultProfile, loadCases: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180" viewBox="0 0 520 180"><text x="24" y="34" font-family="Arial" font-size="18" font-weight="700">Engineering result summary</text><text x="24" y="72" font-family="Arial" font-size="12">Results: ${escapeXml(profile.resultTypes.join(', ') || 'unknown')}</text><text x="24" y="96" font-family="Arial" font-size="12">Units: ${escapeXml(profile.units.join(', ') || 'unknown')}</text><text x="24" y="120" font-family="Arial" font-size="12">Load cases: ${escapeXml(loadCases.join(', ') || 'unknown')}</text></svg>`;
}

function isNumeric(value: string | undefined): boolean {
  return !!value && Number.isFinite(Number.parseFloat(value));
}

function isUnsupportedNativeResult(input: string): boolean {
  return /^[^\r\n]+\.(?:rst|odb|op2|db|mechdb|cdb)$/i.test(input.trim());
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
