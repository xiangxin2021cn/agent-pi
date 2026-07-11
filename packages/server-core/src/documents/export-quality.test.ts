import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strToU8, zipSync } from 'fflate';
import type { SessionArtifactDeliverable } from '@craft-agent/shared/sessions';
import { auditExportedArtifact } from './export-quality.ts';

let testDir = '';

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'agent-pi-export-quality-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function deliverable(format: string, validationLevel: SessionArtifactDeliverable['validationLevel']): SessionArtifactDeliverable {
  return {
    id: `artifact-${format.toLowerCase()}-1`,
    kind: format === 'DOCX' ? 'document' : 'other',
    format,
    required: true,
    origin: 'explicit',
    validationLevel,
  };
}

describe('export quality audit', () => {
  test('reports unknown professional formats as existence-only', async () => {
    const path = join(testDir, 'schedule.xer');
    await writeFile(path, 'ERMHDR\t23.12\n%T\tPROJECT\n', 'utf8');

    const report = await auditExportedArtifact({
      path,
      deliverable: deliverable('XER', 'existence'),
    });

    expect(report.passed).toBe(true);
    expect(report.achievedValidationLevel).toBe('existence');
    expect(report.limitations).toContain('XER validation is limited to non-empty file existence.');
  });

  test('fails empty output files at every validation level', async () => {
    const path = join(testDir, 'empty.md');
    await writeFile(path, '');

    const report = await auditExportedArtifact({
      path,
      deliverable: deliverable('MD', 'syntax'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toContain('Exported artifact is empty.');
  });

  test('validates DOCX structure, requested media, and landscape page intent', async () => {
    const path = join(testDir, 'report.docx');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Report</w:t></w:r></w:p><w:sectPr><w:pgSz w:orient="landscape"/></w:sectPr></w:body></w:document>'),
      'word/media/chart.png': new Uint8Array([1, 2, 3]),
    });
    await writeFile(path, bytes);

    const report = await auditExportedArtifact({
      path,
      deliverable: deliverable('DOCX', 'schema'),
      requireVisualEvidence: true,
      pageIntent: { orientation: 'landscape' },
    });

    expect(report.passed).toBe(true);
    expect(report.achievedValidationLevel).toBe('schema');
  });
});
