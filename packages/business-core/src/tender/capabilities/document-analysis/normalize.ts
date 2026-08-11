import { normalizeSourceRefs, sourceRefsNeededCoercion } from '../../source-locator.ts';
import type { TenderDocumentAnalysisData, TenderDocumentAnalysisSection } from './types.ts';

const SECTION_KINDS = new Set<TenderDocumentAnalysisSection['kind']>([
  'project_information',
  'tender_requirements',
  'special_conditions',
  'addenda_clarifications',
  'boq_characteristics',
  'risk_gap',
  'other',
]);

const SECTION_STATUSES = new Set<TenderDocumentAnalysisSection['status']>([
  'draft',
  'reviewed',
  'blocked',
]);

export interface DocumentAnalysisNormalizationResult {
  data: TenderDocumentAnalysisData;
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeSection(
  value: unknown,
  index: number,
  warnings: string[],
): TenderDocumentAnalysisSection | undefined {
  const record = asRecord(value);
  if (!record) {
    warnings.push(`sections[${index}]: skipped non-object`);
    return undefined;
  }

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const documentId = typeof record.documentId === 'string' ? record.documentId.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!id || !documentId || !title) {
    warnings.push(`sections[${index}]: missing id/documentId/title`);
    return undefined;
  }

  const kindRaw = typeof record.kind === 'string' ? record.kind.trim() : 'other';
  const kind = SECTION_KINDS.has(kindRaw as TenderDocumentAnalysisSection['kind'])
    ? kindRaw as TenderDocumentAnalysisSection['kind']
    : 'other';
  if (kind !== kindRaw) warnings.push(`sections[${index}].kind coerced ${kindRaw} → ${kind}`);

  const statusRaw = typeof record.status === 'string' ? record.status.trim() : 'draft';
  const status = SECTION_STATUSES.has(statusRaw as TenderDocumentAnalysisSection['status'])
    ? statusRaw as TenderDocumentAnalysisSection['status']
    : 'draft';
  if (status !== statusRaw) warnings.push(`sections[${index}].status coerced ${statusRaw} → ${status}`);

  if (sourceRefsNeededCoercion(record.sourceRefs)) {
    warnings.push(`sections[${index}].sourceRefs: string/object coercion applied`);
  }

  return {
    id,
    documentId,
    title,
    kind,
    summary: typeof record.summary === 'string' ? record.summary : '',
    sourceRefs: normalizeSourceRefs(record.sourceRefs),
    status,
  };
}

/**
 * Lenient normalization for LLM-produced document-analysis payloads.
 * Coerces string sourceRefs to locator objects before Zod parse.
 */
export function normalizeDocumentAnalysis(input: unknown): DocumentAnalysisNormalizationResult {
  const warnings: string[] = [];
  const root = asRecord(input);
  const rawSections = Array.isArray(root?.sections) ? root.sections : [];
  if (!Array.isArray(root?.sections)) {
    warnings.push('sections missing or not an array');
  }

  const sections = rawSections.flatMap((entry, index) => {
    const section = normalizeSection(entry, index, warnings);
    return section ? [section] : [];
  });

  return { data: { sections }, warnings };
}
