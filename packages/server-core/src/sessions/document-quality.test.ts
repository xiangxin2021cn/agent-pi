import { describe, expect, test } from 'bun:test';
import { analyzeDocumentQuality, formatDocumentQualityReport, type DocumentQualityReport } from './document-quality.ts';

describe('document quality report formatting', () => {
  test('keeps old reports compatible when visual and template dimensions are absent', () => {
    const report = analyzeDocumentQuality({
      contents: ['# Report\n\n## Scope\n\nThis paragraph contains enough detail to act as a normal document quality input with source citation [1].'],
    });

    const formatted = formatDocumentQualityReport(report);

    expect(formatted).toContain('dimensions: structure=');
    expect(formatted).not.toContain('visuals=');
    expect(formatted).not.toContain('template=');
  });

  test('includes optional visual and template dimensions when present', () => {
    const report: DocumentQualityReport = {
      passed: true,
      score: 90,
      threshold: 70,
      issues: [],
      strengths: [],
      dimensions: {
        structure: 90,
        evidence: 80,
        numbers: 80,
        specification: 70,
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
