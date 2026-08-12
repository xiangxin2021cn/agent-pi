import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  TenderProjectBoundaryExtractedInventory,
  TenderProjectBoundaryPack,
  TenderProjectBoundarySource,
  TenderProjectBoundaryStandardRef,
} from '@agent-pi/business-core/tender';
import { TENDER_WRITING_CONTRACT_BRIEF } from '@craft-agent/shared/business-projects';
import { artifactLooksAcceptable } from './tender-document-artifacts.ts';
import { parseableBoundarySources } from './tender-boundary-sources.ts';

export interface TenderBoundaryBatchBrief {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  objective: string;
  writingContract: string;
  source: TenderProjectBoundarySource;
  allowedSources: Array<{ path?: string; knowledgeSlug?: string; documentId?: string }>;
  outputSchema: Record<string, unknown>;
  reportPath: string;
  markdownPath: string;
  spawnPolicy: 'forbidden';
  finalArtifactPolicy: 'report-and-markdown';
}

export interface TenderBoundaryBatchRecord {
  batchId: string;
  sourceId: string;
  sourcePath?: string;
  briefPath: string;
  reportPath: string;
  markdownPath: string;
  status: 'pending' | 'complete' | 'invalid';
  validationErrors: string[];
  validationWarnings?: string[];
}

export interface TenderBoundaryBatchManifest {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  sourceCount: number;
  batchCount: number;
  completedBatches: number;
  missingSourceIds: string[];
  batches: TenderBoundaryBatchRecord[];
  manifestPath: string;
}

export interface TenderBoundaryParseReport {
  schemaVersion: 1;
  batchId: string;
  sourceId: string;
  summary: string;
  technicalSpecs: TenderProjectBoundaryStandardRef[];
  inventory: TenderProjectBoundaryExtractedInventory;
  organizationNotes?: string;
  bidderResourcesOutline?: string;
}

function writeJsonIfChanged(filePath: string, value: unknown): boolean {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(filePath)) {
    try {
      if (readFileSync(filePath, 'utf8') === next) return false;
    } catch {
      // fall through
    }
  }
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, next, 'utf8');
  renameSync(tempPath, filePath);
  return true;
}

function safeStem(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source';
}

export function boundaryParseMarkdownPath(
  projectRoot: string,
  projectId: string,
  source: TenderProjectBoundarySource,
): string {
  const stem = safeStem(source.title || source.path || source.id);
  return join(projectRoot, 'Agent Pi Outputs', projectId, 'project-boundary', `${source.id}__${stem}.md`);
}

function reportSchema(batchId: string, sourceId: string): Record<string, unknown> {
  return {
    type: 'object',
    required: ['schemaVersion', 'sourceId', 'summary'],
    properties: {
      schemaVersion: { const: 1 },
      batchId: { type: 'string', description: `Prefer ${batchId}; brief path is authoritative.` },
      sourceId: { const: sourceId },
      summary: { type: 'string' },
      technicalSpecs: { type: 'array' },
      inventory: { type: 'object' },
      organizationNotes: { type: 'string' },
      bidderResourcesOutline: { type: 'string' },
    },
  };
}

function buildObjective(source: TenderProjectBoundarySource): string {
  return [
    `Parse the assigned project-boundary source for THIS tender's fence pack.`,
    `Source kind: ${source.kind}. Role: ${source.role}. Title: ${source.title}.`,
    source.kind === 'bidder_resource'
      ? 'Extract owned plant, labour, materials, camp/establishment, rates, and organisation constraints. Do not invent fleet the file does not list.'
      : 'Extract governing specification / measurement / method names, versions, and bid consequences. Do not recatalog the whole standard.',
    'Write JSON to reportPath and a customer-facing Markdown memo to markdownPath.',
    'Honor writingContract.',
  ].join(' ');
}

function validateReport(
  reportPath: string,
  markdownPath: string,
  batchId: string,
  sourceId: string,
): { status: TenderBoundaryBatchRecord['status']; errors: string[]; warnings: string[] } {
  if (!existsSync(reportPath)) return { status: 'pending', errors: [], warnings: [] };
  const warnings: string[] = [];
  if (!artifactLooksAcceptable(markdownPath)) {
    warnings.push(`Customer-facing Markdown missing or too thin at ${markdownPath} (soft).`);
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    const errors: string[] = [];
    if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (typeof report.sourceId === 'string' && report.sourceId.trim() && report.sourceId !== sourceId) {
      errors.push(`sourceId must be ${sourceId}`);
    }
    if (typeof report.summary !== 'string' || !report.summary.trim()) {
      errors.push('summary is required');
    }
    void batchId;
    return { status: errors.length === 0 ? 'complete' : 'invalid', errors, warnings };
  } catch (error) {
    return {
      status: 'invalid',
      errors: [error instanceof Error ? error.message : String(error)],
      warnings,
    };
  }
}

export function createOrRefreshBoundaryBatchManifest(
  projectDirectory: string,
  projectId: string,
  sources: TenderProjectBoundarySource[],
  options: { projectRoot?: string } = {},
): TenderBoundaryBatchManifest {
  const projectRoot = options.projectRoot ?? projectDirectory;
  const parseable = parseableBoundarySources(sources);
  const briefDirectory = join(projectDirectory, 'orchestration', 'briefs', 'project-boundary');
  const reportDirectory = join(projectDirectory, 'orchestration', 'reports', 'project-boundary');
  mkdirSync(briefDirectory, { recursive: true });
  mkdirSync(reportDirectory, { recursive: true });

  const batches: TenderBoundaryBatchRecord[] = [];
  for (const source of parseable) {
    const batchId = `boundary-${createHash('sha256').update(source.id).digest('hex').slice(0, 12)}`;
    const briefPath = join(briefDirectory, `${batchId}.json`);
    const reportPath = join(reportDirectory, `${batchId}.json`);
    const markdownPath = source.markdownPath
      ?? boundaryParseMarkdownPath(projectRoot, projectId, source);
    const brief: TenderBoundaryBatchBrief = {
      schemaVersion: 1,
      projectId,
      batchId,
      objective: buildObjective(source),
      writingContract: TENDER_WRITING_CONTRACT_BRIEF,
      source: { ...source, markdownPath },
      allowedSources: [
        {
          ...(source.path ? { path: source.path } : {}),
          ...(source.knowledgeSlug ? { knowledgeSlug: source.knowledgeSlug } : {}),
          ...(source.documentId ? { documentId: source.documentId } : {}),
        },
      ],
      outputSchema: reportSchema(batchId, source.id),
      reportPath,
      markdownPath,
      spawnPolicy: 'forbidden',
      finalArtifactPolicy: 'report-and-markdown',
    };
    writeJsonIfChanged(briefPath, brief);
    const validation = validateReport(reportPath, markdownPath, batchId, source.id);
    batches.push({
      batchId,
      sourceId: source.id,
      ...(source.path ? { sourcePath: source.path } : {}),
      briefPath,
      reportPath,
      markdownPath,
      status: validation.status,
      validationErrors: validation.errors,
      ...(validation.warnings.length > 0 ? { validationWarnings: validation.warnings } : {}),
    });
  }

  const completedBatches = batches.filter((batch) => batch.status === 'complete').length;
  const missingSourceIds = batches
    .filter((batch) => batch.status !== 'complete')
    .map((batch) => batch.sourceId);
  const manifest: TenderBoundaryBatchManifest = {
    schemaVersion: 1,
    projectId,
    generatedAt: new Date().toISOString(),
    sourceCount: parseable.length,
    batchCount: batches.length,
    completedBatches,
    missingSourceIds,
    batches,
    manifestPath: join(projectDirectory, 'boundary-batch-manifest.json'),
  };
  writeJsonIfChanged(manifest.manifestPath, {
    schemaVersion: 1,
    projectId,
    generatedAt: manifest.generatedAt,
    sourceCount: manifest.sourceCount,
    batchCount: manifest.batchCount,
    completedBatches: manifest.completedBatches,
    missingSourceIds: manifest.missingSourceIds,
    batches: manifest.batches.map((batch) => ({
      batchId: batch.batchId,
      sourceId: batch.sourceId,
      status: batch.status,
      briefPath: batch.briefPath,
      reportPath: batch.reportPath,
      markdownPath: batch.markdownPath,
    })),
  });
  return manifest;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    next.push(trimmed);
  }
  return next;
}

function readParseReport(reportPath: string, sourceId: string): TenderBoundaryParseReport | null {
  if (!existsSync(reportPath)) return null;
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    const inventory = (report.inventory ?? {}) as Record<string, unknown>;
    const asList = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    const specs = Array.isArray(report.technicalSpecs)
      ? report.technicalSpecs.filter((item): item is TenderProjectBoundaryStandardRef => (
        Boolean(item) && typeof item === 'object'
        && typeof (item as TenderProjectBoundaryStandardRef).id === 'string'
        && typeof (item as TenderProjectBoundaryStandardRef).title === 'string'
      ))
      : [];
    return {
      schemaVersion: 1,
      batchId: typeof report.batchId === 'string' ? report.batchId : sourceId,
      sourceId,
      summary: typeof report.summary === 'string' ? report.summary : '',
      technicalSpecs: specs,
      inventory: {
        plant: asList(inventory.plant),
        labour: asList(inventory.labour),
        materialSources: asList(inventory.materialSources),
        constraints: asList(inventory.constraints),
      },
      ...(typeof report.organizationNotes === 'string' ? { organizationNotes: report.organizationNotes } : {}),
      ...(typeof report.bidderResourcesOutline === 'string' ? { bidderResourcesOutline: report.bidderResourcesOutline } : {}),
    };
  } catch {
    return null;
  }
}

export function mergeBoundaryParseReports(input: {
  pack: TenderProjectBoundaryPack;
  sources: TenderProjectBoundarySource[];
  manifest: TenderBoundaryBatchManifest;
}): TenderProjectBoundaryPack {
  const byId = new Map(input.sources.map((source) => [source.id, { ...source }]));
  const specs: TenderProjectBoundaryStandardRef[] = [...input.pack.standards.technicalSpecs];
  const inventory: TenderProjectBoundaryExtractedInventory = {
    plant: [...(input.pack.extractedInventory?.plant ?? [])],
    labour: [...(input.pack.extractedInventory?.labour ?? [])],
    materialSources: [...(input.pack.extractedInventory?.materialSources ?? [])],
    constraints: [...(input.pack.extractedInventory?.constraints ?? [])],
  };
  const organizationParts: string[] = [];
  const resourceParts: string[] = [];

  for (const batch of input.manifest.batches) {
    const source = byId.get(batch.sourceId);
    if (!source) continue;
    if (batch.status !== 'complete') {
      byId.set(batch.sourceId, { ...source, parseStatus: batch.status === 'invalid' ? 'failed' : 'registered', markdownPath: batch.markdownPath });
      continue;
    }
    const report = readParseReport(batch.reportPath, batch.sourceId);
    byId.set(batch.sourceId, {
      ...source,
      parseStatus: 'parsed',
      markdownPath: batch.markdownPath,
    });
    if (!report) continue;
    specs.push(...report.technicalSpecs);
    inventory.plant.push(...report.inventory.plant);
    inventory.labour.push(...report.inventory.labour);
    inventory.materialSources.push(...report.inventory.materialSources);
    inventory.constraints.push(...report.inventory.constraints);
    if (report.organizationNotes?.trim()) organizationParts.push(report.organizationNotes.trim());
    if (report.bidderResourcesOutline?.trim()) resourceParts.push(report.bidderResourcesOutline.trim());
  }

  for (const source of input.sources) {
    if (!byId.has(source.id)) byId.set(source.id, source);
  }

  const specById = new Map<string, TenderProjectBoundaryStandardRef>();
  for (const spec of specs) {
    if (!specById.has(spec.id)) specById.set(spec.id, spec);
  }

  const outlineFromFiles = organizationParts.join('\n\n');
  const resourcesFromFiles = resourceParts.join('\n\n');
  const existingOutline = input.pack.organizationOutline.text.trim();
  const existingResources = input.pack.bidderResources.outline.trim();

  return {
    ...input.pack,
    standards: {
      ...input.pack.standards,
      technicalSpecs: [...specById.values()],
    },
    bidderResources: {
      ...input.pack.bidderResources,
      outline: existingResources || resourcesFromFiles || input.pack.bidderResources.outline,
      ownedPlant: uniqueStrings([...(input.pack.bidderResources.ownedPlant ?? []), ...inventory.plant]),
      ownedLabour: uniqueStrings([...(input.pack.bidderResources.ownedLabour ?? []), ...inventory.labour]),
      materialSources: uniqueStrings([...(input.pack.bidderResources.materialSources ?? []), ...inventory.materialSources]),
    },
    organizationOutline: {
      ...input.pack.organizationOutline,
      text: existingOutline.length >= 80 ? existingOutline : (outlineFromFiles || existingOutline),
    },
    boundarySources: [...byId.values()],
    extractedInventory: {
      plant: uniqueStrings(inventory.plant),
      labour: uniqueStrings(inventory.labour),
      materialSources: uniqueStrings(inventory.materialSources),
      constraints: uniqueStrings(inventory.constraints),
    },
    readiness: input.pack.humanConfirmedAt ? input.pack.readiness : 'needs_review',
  };
}
