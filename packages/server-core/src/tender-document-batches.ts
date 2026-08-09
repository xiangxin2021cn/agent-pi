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
  spawnPolicy: 'forbidden';
  finalArtifactPolicy: 'report-only';
}

export interface TenderDocumentAnalysisBatchRecord {
  batchId: string;
  documentId: string;
  sourcePath: string;
  briefPath: string;
  reportPath: string;
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

export function createOrRefreshDocumentAnalysisBatchManifest(
  projectDirectory: string,
  projectId: string,
  sources: TenderDocumentBatchSource[],
): TenderDocumentAnalysisBatchManifest {
  const briefDirectory = join(projectDirectory, 'orchestration', 'briefs', 'document-analysis');
  const reportDirectory = join(projectDirectory, 'orchestration', 'reports', 'document-analysis');
  const manifestPath = join(projectDirectory, 'document-analysis-batch-manifest.json');
  mkdirSync(briefDirectory, { recursive: true });
  mkdirSync(reportDirectory, { recursive: true });

  const batches = [...sources]
    .sort((left, right) => left.priority - right.priority || left.documentId.localeCompare(right.documentId))
    .map((source): TenderDocumentAnalysisBatchRecord => {
      const batchId = `document-${createHash('sha256').update(`${source.documentId}\u0000${source.path}`).digest('hex').slice(0, 12)}`;
      const briefPath = join(briefDirectory, `${batchId}.json`);
      const reportPath = join(reportDirectory, `${batchId}.json`);
      const brief: TenderDocumentAnalysisBatchBrief = {
        schemaVersion: 1,
        projectId,
        batchId,
        objective: 'Analyze exactly one registered tender source and return evidence-linked structured sections without cross-document inference.',
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
        spawnPolicy: 'forbidden',
        finalArtifactPolicy: 'report-only',
      };
      atomicWriteJson(briefPath, brief);
      const validation = validateReport(reportPath, batchId, source.documentId);
      return {
        batchId,
        documentId: source.documentId,
        sourcePath: source.path,
        briefPath,
        reportPath,
        status: validation.status,
        validationErrors: validation.errors,
      };
    });

  const completedDocumentIds = new Set(
    batches.filter((batch) => batch.status === 'complete').map((batch) => batch.documentId),
  );
  const manifest: TenderDocumentAnalysisBatchManifest = {
    schemaVersion: 1,
    projectId,
    generatedAt: new Date().toISOString(),
    documentCount: sources.length,
    batchCount: batches.length,
    completedBatches: batches.filter((batch) => batch.status === 'complete').length,
    missingDocumentIds: sources.map((source) => source.documentId).filter((id) => !completedDocumentIds.has(id)),
    batches,
    manifestPath,
  };
  atomicWriteJson(manifestPath, manifest);
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
  batchId: string,
  documentId: string,
): { status: TenderDocumentAnalysisBatchRecord['status']; errors: string[] } {
  if (!existsSync(reportPath)) return { status: 'pending', errors: [] };
  try {
    const { errors } = readReport(reportPath, batchId, documentId);
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

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, filePath);
}
