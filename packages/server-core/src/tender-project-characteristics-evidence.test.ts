import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TenderDocumentAnalysisData } from '@agent-pi/business-core/tender';
import {
  PROJECT_CHARACTERISTICS_EVIDENCE_GATE,
  assessProjectCharacteristicsEvidence,
  authorizeProjectCharacteristicsWebDiligence,
  looksLikeProjectCharacteristicsEvidenceFile,
  projectCharacteristicsEvidenceMissingItems,
  writeProjectCharacteristicsEvidenceLedger,
} from './tender-project-characteristics-evidence.ts';

const emptyData: TenderDocumentAnalysisData = { sections: [] };

describe('project characteristics evidence', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('treats BOQ-only registration as a blocking evidence gap', () => {
    const ledger = assessProjectCharacteristicsEvidence({
      projectId: 'n3',
      data: emptyData,
      sourceFiles: [
        { kind: 'boq', name: 'BOQ.xlsx', path: 'C:/inputs/BOQ.xlsx', status: 'registered' },
      ],
    });
    expect(ledger.blockingGapCount).toBeGreaterThan(0);
    expect(projectCharacteristicsEvidenceMissingItems(ledger)).toEqual([
      PROJECT_CHARACTERISTICS_EVIDENCE_GATE,
    ]);
  });

  test('does not block when a specification PDF is registered', () => {
    const ledger = assessProjectCharacteristicsEvidence({
      projectId: 'n3',
      data: emptyData,
      sourceFiles: [
        { kind: 'boq', name: 'BOQ.xlsx', path: 'C:/inputs/BOQ.xlsx', status: 'registered' },
        { kind: 'specification', name: 'Specification.pdf', path: 'C:/inputs/Specification.pdf', status: 'registered' },
      ],
    });
    expect(ledger.blockingGapCount).toBe(0);
    expect(projectCharacteristicsEvidenceMissingItems(ledger)).toEqual([]);
    expect(ledger.evidenceFileNames).toContain('Specification.pdf');
    expect(ledger.gaps.some((gap) => gap.reason === 'empty_chapter')).toBe(true);
  });

  test('treats a Chinese 规范 filename as evidence even when kind is other', () => {
    expect(looksLikeProjectCharacteristicsEvidenceFile({
      kind: 'other',
      name: '项目技术规范.pdf',
      status: 'registered',
    })).toBe(true);
  });

  test('force-pass authorization clears the missing-item gate', () => {
    root = mkdtempSync(join(tmpdir(), 'char-evidence-'));
    const assessed = assessProjectCharacteristicsEvidence({
      projectId: 'n3',
      data: emptyData,
      sourceFiles: [{ kind: 'boq', name: 'BOQ.xlsx', status: 'registered' }],
    });
    writeProjectCharacteristicsEvidenceLedger({ projectDirectory: root, ledger: assessed });
    const authorized = authorizeProjectCharacteristicsWebDiligence({
      projectDirectory: root,
      projectId: 'n3',
    });
    expect(authorized.webDiligenceAuthorizedAt).toBeTruthy();
    expect(projectCharacteristicsEvidenceMissingItems(authorized)).toEqual([]);
  });
});
