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

  test('fails when required sections exist but do not follow the template order', () => {
    const audit = auditTemplateFidelity([
      '## Cost Analysis',
      'This section contains a complete cost analysis with supporting evidence [1] and enough detail for review.',
      '',
      '## Executive Summary',
      'This section contains a complete executive summary with supporting evidence [2] and enough detail for review.',
      '',
      '## Risk Register',
      'This section contains a complete risk register with supporting evidence [3] and enough detail for review.',
    ].join('\n'), { ...profile, tableConvention: undefined, figureConvention: undefined });

    expect(audit.passed).toBe(false);
    expect(audit.issues).toContain('Required sections do not follow the template order.');
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

  test('strict DOCX audit rejects an unresolved source template even when an exported DOCX exists', () => {
    const unresolved: ExtractedTemplateProfile = {
      ...profile,
      sourcePath: 'user-template-request',
      sourceType: 'docx',
      layoutFidelity: 'strict-docx-ooxml',
      sectionOrder: [],
      styles: [],
      fonts: [],
      unknowns: ['Strict template request is pending parsed DOCX profile and exported DOCX evidence.'],
    };
    const audit = auditTemplateFidelity('## Report\n\nSubstantive report content.', unresolved, {
      exportedDocxProfile: {
        ...unresolved,
        id: 'exported',
        sourcePath: 'output.docx',
        unknowns: [],
      },
    });

    expect(audit.passed).toBe(false);
    expect(audit.issues).toContain('Strict template source profile is unresolved; the uploaded template must be parsed before completion.');
  });

  test('strict DOCX audit compares exported page, orientation, margins, fonts, styles, numbering, headers, footers, tables, and captions', () => {
    const templateProfile: ExtractedTemplateProfile = {
      ...profile,
      sourceType: 'docx',
      layoutFidelity: 'strict-docx-ooxml',
      pageSize: 'A4',
      orientation: 'portrait',
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      fonts: ['Arial'],
      styles: [{ id: 'Heading1', name: 'Heading 1', role: 'heading' }],
      tableStyles: ['TableGrid'],
      captionStyles: ['Caption'],
      headerFooterReferences: [
        { type: 'header', id: 'rIdHeader1' },
        { type: 'footer', id: 'rIdFooter1' },
      ],
      numbering: [{ id: '1', levels: 3 }],
    };
    const exportedDocxProfile: ExtractedTemplateProfile = {
      ...templateProfile,
      id: 'exported',
      sourcePath: 'output.docx',
      pageSize: 'A3',
      orientation: 'landscape',
      margins: { top: 720, right: 720, bottom: 720, left: 720 },
      fonts: ['Calibri'],
      styles: [{ id: 'Normal', name: 'Normal', role: 'body' }],
      tableStyles: [],
      captionStyles: [],
      headerFooterReferences: [{ type: 'header', id: 'rIdDifferent' }],
      numbering: [{ id: '8', levels: 1 }],
    };
    const audit = auditTemplateFidelity([
      '## Executive Summary',
      'This section provides enough management-level detail with evidence [1] and clear conclusions for the report.',
      '',
      '## Cost Analysis',
      'This section provides enough cost detail with evidence [2] and clear conclusions for the report.',
      '',
      '## Risk Register',
      'This section provides enough risk detail with evidence [3] and clear conclusions for the report.',
    ].join('\n'), templateProfile, { exportedDocxProfile });

    expect(audit.passed).toBe(false);
    expect(audit.issues).toEqual(expect.arrayContaining([
      'Exported DOCX page size does not match the template.',
      'Exported DOCX orientation does not match the template.',
      'Exported DOCX margins do not match the template.',
      'Exported DOCX fonts do not include all template fonts.',
      'Exported DOCX styles do not include all required template styles.',
      'Exported DOCX table styles do not include all template table styles.',
      'Exported DOCX caption styles do not include all template caption styles.',
      'Exported DOCX header/footer structure does not match the template.',
      'Exported DOCX numbering structure does not match the template.',
    ]));
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
        tableCount: 1,
        placeholderCount: 0,
        internalControlMarkerCount: 0,
        tableLineRatio: 0.1,
      },
    };

    expect(formatDocumentQualityReport(report)).toContain('visuals=88, template=82');
  });
});
