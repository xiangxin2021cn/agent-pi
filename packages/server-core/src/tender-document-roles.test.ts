import { describe, expect, test } from 'bun:test';
import {
  buildProfessionalDocumentAnalysisObjective,
  inferDocumentRole,
  inferProjectIndustry,
} from './tender-document-roles.ts';

describe('tender-document-roles', () => {
  test('infers highway industry from SANRAL/R573 hints', () => {
    expect(inferProjectIndustry([
      { name: 'SANRAL R.573-020 BOQ.xlsx', path: 'Volume 3/BOQ.xlsx', kind: 'boq' },
    ])).toBe('highway_road');
  });

  test('infers document roles', () => {
    expect(inferDocumentRole({ name: 'Health and Safety Specification.pdf', kind: 'specification' })).toBe('hse_ohs');
    expect(inferDocumentRole({ name: 'SANRAL BOQ.xlsx', kind: 'boq' })).toBe('boq_pricing_schedule');
    expect(inferDocumentRole({ name: 'GA Granted 2017.pdf', kind: 'other' })).toBe('environmental_permit');
  });

  test('professional objective avoids file-catalog framing', () => {
    const objective = buildProfessionalDocumentAnalysisObjective({
      projectIndustry: 'highway_road',
      documentRole: 'hse_ohs',
    });
    expect(objective).toContain('highway');
    expect(objective).toContain('HSE');
    expect(objective).toContain('Do NOT center the report on filenames');
    expect(objective).toContain('markdownPath');
    expect(objective).toContain('Read [skill:tender-formal-writing] then honor writingContract');
    expect(objective).toContain('AI filler');
  });
});
