import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  parseTenderDocumentAnalysisData,
  type TenderDocumentAnalysisData,
  type TenderDocumentAnalysisSection,
  type TenderDocumentKind,
} from '@agent-pi/business-core/tender';
import {
  mergeDocumentAnalysisBatchReports as mergeDocumentAnalysisBatchReportsCore,
  validateDocumentAnalysisBatchMerge as validateDocumentAnalysisBatchMergeCore,
} from '@craft-agent/session-tools-core';
import { artifactLooksAcceptable, documentArtifactPath } from './tender-document-artifacts.ts';

export interface TenderDocumentBatchSource {
  documentId: string;
  path: string;
  name: string;
  kind: TenderDocumentKind | string;
  priority: number;
}

export interface TenderDocumentAnalysisBatchBrief {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  objective: string;
  scope: {
    documentId: string;
    name: string;
    kind: string;
    priority: number;
  };
  requiredSectionKinds: string[];
  allowedSources: Array<{ documentId: string; path: string }>;
  outputSchema: Record<string, unknown>;
  reportPath: string;
  /** Customer-facing readable parse — written by the child, not the parent. */
  markdownPath: string;
  spawnPolicy: 'forbidden';
  finalArtifactPolicy: 'report-and-markdown';
}

export interface TenderDocumentAnalysisBatchRecord {
  batchId: string;
  documentId: string;
  sourcePath: string;
  briefPath: string;
  reportPath: string;
  markdownPath: string;
  status: 'pending' | 'complete' | 'invalid';
  validationErrors: string[];
}

export interface TenderDocumentAnalysisBatchManifest {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  documentCount: number;
  batchCount: number;
  completedBatches: number;
  missingDocumentIds: string[];
  batches: TenderDocumentAnalysisBatchRecord[];
  manifestPath: string;
}

const SECTION_KINDS = [
  'project_information',
  'tender_requirements',
  'special_conditions',
  'addenda_clarifications',
  'boq_characteristics',
  'risk_gap',
  'other',
] as const;

export async function createOrRefreshDocumentAnalysisBatchManifest(
  projectDirectory: string,
  projectId: string,
  sources: TenderDocumentBatchSource[],
  options: { projectRoot?: string } = {},
): Promise<TenderDocumentAnalysisBatchManifest> {
  const projectRoot = options.projectRoot ?? inferProjectRoot(projectDirectory);
  const briefDirectory = join(projectDirectory, 'orchestration', 'briefs', 'document-analysis');
  const reportDirectory = join(projectDirectory, 'orchestration', 'reports', 'document-analysis');
  const manifestPath = join(projectDirectory, 'document-analysis-batch-manifest.json');
  mkdirSync(briefDirectory, { recursive: true });
  mkdirSync(reportDirectory, { recursive: true });

  const sorted = [...sources]
    .sort((left, right) => left.priority - right.priority || left.documentId.localeCompare(right.documentId));
  const batches: TenderDocumentAnalysisBatchRecord[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const source = sorted[index]!;
    const batchId = `document-${createHash('sha256').update(`${source.documentId}\u0000${source.path}`).digest('hex').slice(0, 12)}`;
    const briefPath = join(briefDirectory, `${batchId}.json`);
    const reportPath = join(reportDirectory, `${batchId}.json`);
    const markdownPath = documentArtifactPath(projectRoot, projectId, source.documentId, source.name);
    const brief: TenderDocumentAnalysisBatchBrief = {
      schemaVersion: 1,
      projectId,
      batchId,
      objective:
        'Analyze exactly one registered tender source. Produce useful structured sections (JSON at reportPath) '
        + 'and a readable Markdown analysis (markdownPath). Prefer substance over citation ritual — '
        + 'empty sourceRefs are accepted; documentId/batchId are inferred from the brief when omitted. '
        + 'No cross-document invention.',
      scope: {
        documentId: source.documentId,
        name: source.name,
        kind: source.kind,
        priority: source.priority,
      },
      requiredSectionKinds: [...SECTION_KINDS],
      allowedSources: [{ documentId: source.documentId, path: source.path }],
      outputSchema: reportSchema(batchId, source.documentId),
      reportPath,
      markdownPath,
      spawnPolicy: 'forbidden',
      finalArtifactPolicy: 'report-and-markdown',
    };
    // Status polls used to rewrite every brief on each tick and starve IPC
    // (businessProjects:list timed out at 30s while returning to Overview).
    writeJsonIfChanged(briefPath, brief);
    const validation = validateReport(reportPath, markdownPath, batchId, source.documentId);
    batches.push({
      batchId,
      documentId: source.documentId,
      sourcePath: source.path,
      briefPath,
      reportPath,
      markdownPath,
      status: validation.status,
      validationErrors: validation.errors,
    });
    if (index > 0 && index % 3 === 0) await yieldToEventLoop();
  }

  const completedDocumentIds = new Set(
    batches.filter((batch) => batch.status === 'complete').map((batch) => batch.documentId),
  );
  const previousManifest = existsSync(manifestPath)
    ? (() => {
      try {
        return JSON.parse(readFileSync(manifestPath, 'utf8')) as TenderDocumentAnalysisBatchManifest;
      } catch {
        return undefined;
      }
    })()
    : undefined;
  const manifest: TenderDocumentAnalysisBatchManifest = {
    schemaVersion: 1,
    projectId,
    // Keep generatedAt stable when batch set/status is unchanged so we can skip the rewrite.
    generatedAt: previousManifest
      && previousManifest.projectId === projectId
      && previousManifest.batchCount === batches.length
      && JSON.stringify(previousManifest.batches) === JSON.stringify(batches)
      ? previousManifest.generatedAt
      : new Date().toISOString(),
    documentCount: sources.length,
    batchCount: batches.length,
    completedBatches: batches.filter((batch) => batch.status === 'complete').length,
    missingDocumentIds: sources.map((source) => source.documentId).filter((id) => !completedDocumentIds.has(id)),
    batches,
    manifestPath,
  };
  writeJsonIfChanged(manifestPath, manifest);
  return manifest;
}

/**
 * Deterministically concatenate complete batch reports into final pack data.
 * Duplicate template section ids are namespaced with documentId.
 */
export function mergeDocumentAnalysisBatchReports(
  manifest: TenderDocumentAnalysisBatchManifest,
): { data: TenderDocumentAnalysisData; errors: string[] } {
  if (manifest.batchCount === 0) {
    return { data: { sections: [] }, errors: ['document-batches:no-documents'] };
  }
  if (manifest.completedBatches !== manifest.batchCount || manifest.missingDocumentIds.length > 0) {
    return { data: { sections: [] }, errors: ['document-batches:incomplete'] };
  }
  return mergeDocumentAnalysisBatchReportsCore(manifest.batches);
}

export function validateDocumentAnalysisBatchMerge(
  manifest: TenderDocumentAnalysisBatchManifest,
  finalValue: TenderDocumentAnalysisData | unknown,
): string[] {
  if (manifest.completedBatches !== manifest.batchCount || manifest.missingDocumentIds.length > 0) {
    return ['document-batches:incomplete'];
  }
  return validateDocumentAnalysisBatchMergeCore(manifest.batches, finalValue);
}

function latestQuarantinedReportPath(reportPath: string): string | undefined {
  const directory = dirname(reportPath);
  const base = basename(reportPath);
  if (!existsSync(directory)) return undefined;
  const prefix = `${base}.invalid.`;
  const candidates = readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const fullPath = join(directory, name);
      try {
        return { fullPath, mtimeMs: statSync(fullPath).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { fullPath: string; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.fullPath;
}

/** Prefer live reportPath; otherwise the newest quarantined sibling (stale invalid rename). */
function resolveReportPathForValidation(reportPath: string): { path: string; quarantined: boolean } | undefined {
  if (existsSync(reportPath)) return { path: reportPath, quarantined: false };
  const quarantined = latestQuarantinedReportPath(reportPath);
  return quarantined ? { path: quarantined, quarantined: true } : undefined;
}

function validateReport(
  reportPath: string,
  markdownPath: string,
  batchId: string,
  documentId: string,
): { status: TenderDocumentAnalysisBatchRecord['status']; errors: string[] } {
  const resolved = resolveReportPathForValidation(reportPath);
  if (!resolved) return { status: 'pending', errors: [] };
  try {
    const { errors } = readReport(resolved.path, batchId, documentId);
    if (!artifactLooksAcceptable(markdownPath)) {
      errors.push(
        `Customer-facing Markdown missing or too thin at ${markdownPath}. `
          + 'The child must write this MD (with a title and summary section); do not leave it for the parent.',
      );
    }
    if (errors.length === 0) {
      // Heal: a previously quarantined report that now passes lenient gates is restored.
      if (resolved.quarantined && resolved.path !== reportPath) {
        try {
          renameSync(resolved.path, reportPath);
        } catch {
          // Fall back to copying content if rename fails (e.g. cross-device).
          try {
            writeFileSync(reportPath, readFileSync(resolved.path));
          } catch {
            // Best-effort — validation still reports complete for this tick.
          }
        }
      }
      return { status: 'complete', errors: [] };
    }
    return { status: 'invalid', errors };
  } catch (error) {
    return { status: 'invalid', errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function readReport(
  reportPath: string,
  batchId: string,
  documentId: string,
): { sections: TenderDocumentAnalysisSection[]; errors: string[] } {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
  const errors: string[] = [];
  if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  // Soft: brief path is authoritative — wrong/missing batchId must not burn retries.
  if (typeof report.documentId === 'string' && report.documentId.trim() && report.documentId !== documentId) {
    errors.push(`documentId must be ${documentId}`);
  }
  if (!Array.isArray(report.sections) || report.sections.length === 0) {
    errors.push('sections must be a non-empty array');
    return { sections: [], errors };
  }

  let sections: TenderDocumentAnalysisSection[] = [];
  try {
    // Lenient single-doc normalize: bind locator/excerpt-only citations to the assigned document.
    sections = parseTenderDocumentAnalysisData({
      schemaVersion: report.schemaVersion,
      batchId,
      documentId,
      sections: report.sections.map((section) => (
        isRecord(section) ? { ...section, documentId: section.documentId ?? documentId } : section
      )),
    }, { defaultDocumentId: documentId }).sections;
  } catch (error) {
    errors.push(`sections schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ids = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (ids.has(section.id)) errors.push(`duplicate section id: ${section.id}`);
    else ids.add(section.id);
    if (!section.summary.trim()) errors.push(`sections[${index}].summary is required`);
    // Soft: empty sourceRefs no longer invalidates the batch — evidence is best-effort.
    if (section.sourceRefs.some((source) => source.documentId !== documentId)) {
      errors.push(`sections[${index}].sourceRefs must cite only ${documentId}`);
    }
  }
  return { sections, errors };
}

function reportSchema(batchId: string, documentId: string): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'sections'],
    properties: {
      schemaVersion: { const: 1 },
      batchId: { type: 'string', description: `Prefer ${batchId}; the brief path is authoritative if omitted.` },
      documentId: { type: 'string', description: `Prefer ${documentId}; inferred for single-doc batches.` },
      sections: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'title', 'summary', 'status'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: { enum: SECTION_KINDS },
            title: { type: 'string', minLength: 1 },
            summary: { type: 'string', minLength: 1 },
            sourceRefs: {
              type: 'array',
              description: 'Optional citations (page/locator/excerpt). Empty is accepted.',
              items: { type: 'object' },
            },
            status: { enum: ['draft', 'reviewed', 'blocked'] },
          },
        },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Prefer `<root>` when projectDirectory is `<root>/.agent-pi/business/tender/<id>`. */
function inferProjectRoot(projectDirectory: string): string {
  const normalized = projectDirectory.replace(/\\/g, '/').toLowerCase();
  const marker = '/.agent-pi/business/tender/';
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return projectDirectory.slice(0, index);
  return projectDirectory;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function writeJsonIfChanged(filePath: string, value: unknown): boolean {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(filePath)) {
    try {
      if (readFileSync(filePath, 'utf8') === next) return false;
    } catch {
      // fall through to write
    }
  }
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, next, 'utf8');
  renameSync(tempPath, filePath);
  return true;
}
