import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { getArtifactFormatCapability, normalizeArtifactFormat } from '@craft-agent/shared/artifacts';
import type { SessionArtifactDeliverable, SessionArtifactValidationLevel } from '@craft-agent/shared/sessions';

export interface ExportQualityInput {
  path: string;
  deliverable: SessionArtifactDeliverable;
  requireVisualEvidence?: boolean;
  pageIntent?: {
    orientation?: 'portrait' | 'landscape';
  };
}

export interface ExportQualityReport {
  passed: boolean;
  path: string;
  format: string;
  capabilityId: string;
  declaredValidationLevel: SessionArtifactValidationLevel;
  achievedValidationLevel: SessionArtifactValidationLevel | 'none';
  issues: string[];
  limitations: string[];
}

const VALIDATION_RANK: Record<SessionArtifactValidationLevel, number> = {
  existence: 0,
  syntax: 1,
  schema: 2,
  round_trip: 3,
};

export async function auditExportedArtifact(input: ExportQualityInput): Promise<ExportQualityReport> {
  const format = normalizeArtifactFormat(input.deliverable.format) ?? 'UNKNOWN';
  const capability = getArtifactFormatCapability(format);
  const issues: string[] = [];
  const limitations: string[] = [];
  let achievedValidationLevel: ExportQualityReport['achievedValidationLevel'] = 'none';

  let bytes: Buffer;
  try {
    const fileStat = await stat(input.path);
    if (!fileStat.isFile()) issues.push('Exported artifact path is not a file.');
    bytes = await readFile(input.path);
  } catch (error) {
    issues.push(`Exported artifact is not readable: ${error instanceof Error ? error.message : String(error)}`);
    return buildReport();
  }

  if (bytes.byteLength === 0) {
    issues.push('Exported artifact is empty.');
    return buildReport();
  }
  achievedValidationLevel = 'existence';

  const actualFormat = normalizeArtifactFormat(extname(input.path));
  if (actualFormat && actualFormat !== format) {
    issues.push(`Exported artifact extension ${actualFormat} does not match requested format ${format}.`);
  }

  if (VALIDATION_RANK[input.deliverable.validationLevel] > VALIDATION_RANK[capability.validationLevel]) {
    issues.push(`${format} capability cannot satisfy declared ${input.deliverable.validationLevel} validation.`);
  }

  if (capability.generation === 'unregistered') {
    limitations.push(`${format} validation is limited to non-empty file existence.`);
    return buildReport();
  }

  if (capability.validationLevel === 'existence') return buildReport();

  try {
    if (format === 'PDF') {
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) issues.push('PDF header is invalid.');
    } else if (format === 'JSON') {
      JSON.parse(bytes.toString('utf8'));
    } else if (format === 'HTML') {
      if (!/<(?:!doctype\s+html|html|body)\b/i.test(bytes.toString('utf8'))) issues.push('HTML document structure is missing.');
    } else if (format === 'MD' || format === 'TXT' || format === 'CSV') {
      if (!bytes.toString('utf8').trim()) issues.push(`${format} content is empty after text decoding.`);
    } else if (format === 'DOCX' || format === 'XLSX' || format === 'PPTX') {
      validateOfficePackage(bytes, format, input, issues);
    }
  } catch (error) {
    issues.push(`${format} validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (issues.length === 0) achievedValidationLevel = capability.validationLevel;
  return buildReport();

  function buildReport(): ExportQualityReport {
    return {
      passed: issues.length === 0,
      path: input.path,
      format,
      capabilityId: capability.id,
      declaredValidationLevel: input.deliverable.validationLevel,
      achievedValidationLevel,
      issues,
      limitations,
    };
  }
}

function validateOfficePackage(
  bytes: Buffer,
  format: 'DOCX' | 'XLSX' | 'PPTX',
  input: ExportQualityInput,
  issues: string[],
): void {
  const files = unzipSync(new Uint8Array(bytes));
  if (!files['[Content_Types].xml']) issues.push(`${format} package is missing [Content_Types].xml.`);

  const mainPart = format === 'DOCX'
    ? 'word/document.xml'
    : format === 'XLSX'
      ? 'xl/workbook.xml'
      : 'ppt/presentation.xml';
  const mainBytes = files[mainPart];
  if (!mainBytes) {
    issues.push(`${format} package is missing ${mainPart}.`);
    return;
  }

  const mainXml = strFromU8(mainBytes);
  if (!mainXml.trim()) issues.push(`${format} main document part is empty.`);

  if (input.requireVisualEvidence) {
    const mediaPrefix = format === 'DOCX' ? 'word/media/' : format === 'XLSX' ? 'xl/media/' : 'ppt/media/';
    if (!Object.keys(files).some(name => name.startsWith(mediaPrefix))) {
      issues.push(`${format} package is missing requested visual media.`);
    }
  }

  if (format === 'DOCX' && input.pageIntent?.orientation === 'landscape' && !/w:orient=["']landscape["']/i.test(mainXml)) {
    issues.push('DOCX package is missing requested landscape page intent.');
  }
}
