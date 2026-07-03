import { describe, expect, test } from 'bun:test';
import { formatDocumentQualityReport, type DocumentQualityReport } from '../sessions/document-quality.ts';
import { auditTemplateFidelity } from './template-fidelity.ts';
import type { ExtractedTemplateProfile } from './template-profile.ts';

const profile: ExtractedTemplateProfile = {
  id: 'tpl-1',
  sourcePath: 'template.md',
  sourceType: 'markdown',
  layoutFidelity: 'semantic-only',
  sectionOrder: ['Executive Summary', 'Cost Analysis', 'Risk Register'],
  titleDepth: 2,
  tableConvention: 'markdown-pipe-table',
  figureConvention: 'markdown-image',
  citationStyle: 'numeric-bracket',
  languageStyle: 'en',
  styles: [],
  fonts: [],
  unknowns: [],
};

describe('template fidelity audit', () => {
  test('flags heading mismatch, missing required sections, shallow sections, visual captions, and citation style mismatch', () => {
    const audit = auditTemplateFidelity([
      '# Executive Summary',
      'Too short.',
      '',
      '## Cost Analysis',
      '| Item | Amount |',
      '| --- | ---: |',
      '| Total | 100 |',
      '',
      '![chart](chart.svg)',
      '',
      '(Smith, 2025)',
    ].join('\n'), profile);

    expect(audit.passed).toBe(false);
    expect(audit.issues).toEqual(expect.arrayContaining([
      'Heading depth does not match template title depth 2.',
      'Missing required template section: Risk Register.',
      'Section "Executive Summary" is too shallow for the reference template.',
      'Table or figure caption convention does not match the template.',
      'Citation style does not match template style numeric-bracket.',
    ]));
  });

  test('passes when structure, depth, captions, and citations match the template', () => {
    const audit = auditTemplateFidelity([
      '## Executive Summary',
      'This section provides enough management-level detail with evidence [1] and clear conclusions for the report.',
      '',
      '## Cost Analysis',
      'Table 1. Cost summary.',
      '| Item | Amount |',
      '| --- | ---: |',
      '| Total | 100 |',
      '',
      '## Risk Register',
      'Figure 1. Risk map.',
      '![risk map](risk.svg)',
      'The risk register includes mitigation responsibilities and evidence [2].',
    ].join('\n'), profile);

    expect(audit.passed).toBe(true);
    expect(audit.score).toBeGreaterThanOrEqual(80);
  });

  test('strict DOCX profiles require exported DOCX structure evidence', () => {
    const audit = auditTemplateFidelity('## Executive Summary\n\nContent with enough depth and citation [1].', {
      ...profile,
      sourceType: 'docx',
      layoutFidelity: 'strict-docx-ooxml',
      styles: [{ id: 'Heading1', name: 'Heading 1', role: 'heading' }],
    });

    expect(audit.passed).toBe(false);
    expect(audit.issues).toContain('Strict DOCX template audit requires exported DOCX structure evidence.');
  });

  test('PDF templates are labeled as visual approximations', () => {
    const audit = auditTemplateFidelity('## Executive Summary\n\nEnough content with citation [1].', {
      ...profile,
      sourceType: 'pdf',
      layoutFidelity: 'pdf-visual-approximation',
    });

    expect(audit.approximation).toBe(true);
    expect(audit.issues).toContain('PDF template fidelity is a visual approximation, not Word-level layout matching.');
  });

  test('document quality reports can include optional visual and template metrics without breaking old dimensions', () => {
    const report: DocumentQualityReport = {
      passed: true,
      score: 90,
      threshold: 70,
      issues: [],
      strengths: [],
      dimensions: {
        structure: 90,
        evidence: 90,
        numbers: 80,
        specification: 85,
        risk: 70,
        visuals: 88,
        template: 82,
      },
      metrics: {
        textLength: 1000,
        headingCount: 4,
        paragraphCount: 6,
        citationMarkerCount: 3,
        sourceReferenceCount: 2,
        numericClaimCount: 5,
        tableMarkerCount: 2,
        placeholderCount: 0,
      },
    };

    expect(formatDocumentQualityReport(report)).toContain('visuals=88, template=82');
  });
});
