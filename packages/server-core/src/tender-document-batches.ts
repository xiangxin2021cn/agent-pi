import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
        'Analyze exactly one registered tender source. Write (1) evidence-linked structured sections to reportPath and '
        + '(2) a customer-facing readable Markdown analysis to markdownPath. The Markdown is a first-class deliverable — '
        + 'do not leave it for the parent session. No cross-document inference.',
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

function validateReport(
  reportPath: string,
  markdownPath: string,
  batchId: string,
  documentId: string,
): { status: TenderDocumentAnalysisBatchRecord['status']; errors: string[] } {
  if (!existsSync(reportPath)) return { status: 'pending', errors: [] };
  try {
    const { errors } = readReport(reportPath, batchId, documentId);
    if (!artifactLooksAcceptable(markdownPath)) {
      errors.push(
        `Customer-facing Markdown missing or too thin at ${markdownPath}. `
          + 'The child must write this MD (with a title and summary section); do not leave it for the parent.',
      );
    }
    return { status: errors.length === 0 ? 'complete' : 'invalid', errors };
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
  if (report.batchId !== batchId) errors.push(`batchId must be ${batchId}`);
  if (report.documentId !== documentId) errors.push(`documentId must be ${documentId}`);
  if (!Array.isArray(report.sections) || report.sections.length === 0) {
    errors.push('sections must be a non-empty array');
    return { sections: [], errors };
  }

  let sections: TenderDocumentAnalysisSection[] = [];
  try {
    sections = parseTenderDocumentAnalysisData({
      sections: report.sections.map((section) => isRecord(section) ? { ...section, documentId } : section),
    }).sections;
  } catch (error) {
    errors.push(`sections schema is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ids = new Set<string>();
  for (const [index, section] of sections.entries()) {
    if (ids.has(section.id)) errors.push(`duplicate section id: ${section.id}`);
    else ids.add(section.id);
    if (!section.summary.trim()) errors.push(`sections[${index}].summary is required`);
    if (section.sourceRefs.length === 0) errors.push(`sections[${index}].sourceRefs must be non-empty`);
    else if (section.sourceRefs.some((source) => source.documentId !== documentId)) {
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
    required: ['schemaVersion', 'batchId', 'documentId', 'sections'],
    properties: {
      schemaVersion: { const: 1 },
      batchId: { const: batchId },
      documentId: { const: documentId },
      sections: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'title', 'summary', 'sourceRefs', 'status'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: { enum: SECTION_KINDS },
            title: { type: 'string', minLength: 1 },
            summary: { type: 'string', minLength: 1 },
            sourceRefs: { type: 'array', minItems: 1 },
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
