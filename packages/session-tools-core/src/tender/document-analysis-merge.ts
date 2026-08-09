/**
 * Deterministic document-analysis pack merge from per-document batch reports.
 *
 * Child agents often reuse template section ids (sec-01-..., sec-02-...).
 * Final pack ids are namespaced with documentId so the merge is unique and
 * stable, without requiring the parent model to inline a huge JSON payload.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  parseTenderDocumentAnalysisData,
  type TenderDocumentAnalysisData,
  type TenderDocumentAnalysisSection,
} from '@agent-pi/business-core/tender';

export interface DocumentAnalysisMergeBatch {
  batchId: string;
  documentId: string;
  reportPath: string;
  status: 'pending' | 'complete' | 'invalid' | string;
}

export function makeNamespacedDocumentAnalysisSectionId(documentId: string, sectionId: string): string {
  const already = sectionId.toLowerCase();
  const prefix = `${documentId}--`.toLowerCase();
  if (already.startsWith(prefix) && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(sectionId)) {
    return sectionId.length <= 80 ? sectionId : sectionId.slice(0, 80);
  }
  const raw = `${documentId}--${sectionId}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (raw.length >= 1 && raw.length <= 80 && /^[a-z0-9]/i.test(raw)) return raw;
  const hash = createHash('sha256').update(`${documentId}\u0000${sectionId}`).digest('hex').slice(0, 20);
  return `s-${hash}`;
}

export function finalizeMergedDocumentAnalysisSection(
  section: TenderDocumentAnalysisSection,
  documentId: string,
): TenderDocumentAnalysisSection {
  return {
    ...section,
    documentId,
    id: makeNamespacedDocumentAnalysisSectionId(documentId, section.id),
  };
}

function readBatchReport(
  reportPath: string,
  batchId: string,
  documentId: string,
): { sections: TenderDocumentAnalysisSection[]; errors: string[] } {
  if (!existsSync(reportPath)) return { sections: [], errors: [`report missing: ${reportPath}`] };
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    const errors: string[] = [];
    if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (report.batchId !== batchId) errors.push(`batchId must be ${batchId}`);
    if (report.documentId !== documentId) errors.push(`documentId must be ${documentId}`);
    if (!Array.isArray(report.sections) || report.sections.length === 0) {
      return { sections: [], errors: [...errors, 'sections must be a non-empty array'] };
    }
    const sections = parseTenderDocumentAnalysisData({
      sections: report.sections.map((section) => (
        section && typeof section === 'object'
          ? { ...(section as Record<string, unknown>), documentId }
          : section
      )),
    }).sections;
    return { sections, errors };
  } catch (error) {
    return { sections: [], errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function mergeDocumentAnalysisBatchReports(
  batches: DocumentAnalysisMergeBatch[],
): { data: TenderDocumentAnalysisData; errors: string[] } {
  const errors: string[] = [];
  const sections: TenderDocumentAnalysisSection[] = [];
  const seenIds = new Set<string>();

  if (batches.length === 0) {
    return { data: { sections: [] }, errors: ['document-batches:no-documents'] };
  }
  if (batches.some((batch) => batch.status !== 'complete')) {
    return { data: { sections: [] }, errors: ['document-batches:incomplete'] };
  }

  for (const batch of batches) {
    const report = readBatchReport(batch.reportPath, batch.batchId, batch.documentId);
    if (report.errors.length > 0) {
      errors.push(...report.errors.map((error) => `${batch.batchId}: ${error}`));
      continue;
    }
    for (const section of report.sections) {
      const finalized = finalizeMergedDocumentAnalysisSection(section, batch.documentId);
      if (seenIds.has(finalized.id)) {
        errors.push(`duplicate merged document section: ${finalized.id}`);
        continue;
      }
      seenIds.add(finalized.id);
      sections.push(finalized);
    }
  }

  if (errors.length > 0) return { data: { sections: [] }, errors };
  return { data: parseTenderDocumentAnalysisData({ sections }), errors: [] };
}

export function validateDocumentAnalysisBatchMerge(
  batches: DocumentAnalysisMergeBatch[],
  finalValue: TenderDocumentAnalysisData | unknown,
): string[] {
  const merged = mergeDocumentAnalysisBatchReports(batches);
  if (merged.errors.length > 0) return merged.errors;

  let finalData: TenderDocumentAnalysisData;
  try {
    finalData = parseTenderDocumentAnalysisData(finalValue);
  } catch (error) {
    return [`invalid final document analysis pack: ${error instanceof Error ? error.message : String(error)}`];
  }

  const expected = new Map(merged.data.sections.map((section) => [section.id, section]));
  const actual = new Map<string, TenderDocumentAnalysisSection>();
  for (const section of finalData.sections) {
    if (actual.has(section.id)) return [`duplicate final document section: ${section.id}`];
    actual.set(section.id, section);
  }
  const errors: string[] = [];
  for (const [sectionId, reported] of expected) {
    const finalSection = actual.get(sectionId);
    if (!finalSection) errors.push(`missing final document section: ${sectionId}`);
    else if (!isDeepStrictEqual(finalSection, reported)) {
      errors.push(`final document section differs from merged batch report: ${sectionId}`);
    }
  }
  for (const sectionId of actual.keys()) {
    if (!expected.has(sectionId)) errors.push(`unexpected final document section: ${sectionId}`);
  }
  return errors;
}
