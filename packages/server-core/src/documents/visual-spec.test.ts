import { describe, expect, test } from 'bun:test';
import type { VisualSpec } from '@craft-agent/shared/document-visuals';
import { validateVisualSpec } from './visual-spec.ts';

const baseSpec: VisualSpec = {
  id: 'visual-1',
  kind: 'construction-gantt',
  title: 'Baseline and Current Programme',
  caption: 'Figure 1. Baseline and current construction programme.',
  altText: 'Construction tasks grouped by WBS with baseline and current bars.',
  evidenceType: 'data_derived',
  sourceRefs: ['schedule.xlsx#Programme'],
  dataPath: 'visuals/programme.data.json',
  assetPath: 'visuals/programme.svg',
  target: {
    formats: ['MD', 'DOCX'],
    pageSize: 'A3',
    orientation: 'landscape',
  },
};

describe('visual spec validation', () => {
  test('requires accessible reader-facing metadata', () => {
    const report = validateVisualSpec({ ...baseSpec, altText: '' });

    expect(report.passed).toBe(false);
    expect(report.issues).toContain('Visual requires non-empty alt text.');
  });

  test('requires a reusable sidecar for data-derived visuals', () => {
    const report = validateVisualSpec({ ...baseSpec, dataPath: undefined });

    expect(report.passed).toBe(false);
    expect(report.issues).toContain('Data-derived visual requires a data sidecar.');
  });

  test('requires at least one target delivery format', () => {
    const report = validateVisualSpec({ ...baseSpec, target: { formats: [] } });

    expect(report.passed).toBe(false);
    expect(report.issues).toContain('Visual requires at least one target delivery format.');
  });

  test('passes a source-backed data-derived visual', () => {
    expect(validateVisualSpec(baseSpec)).toEqual({ passed: true, issues: [] });
  });
});
