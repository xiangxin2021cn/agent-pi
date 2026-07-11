import { describe, expect, test } from 'bun:test';
import { analyzeDocumentQuality, formatDocumentQualityReport, type DocumentQualityReport } from './document-quality.ts';

describe('document quality report formatting', () => {
  test('fails reader-facing cleanliness when internal control artifacts leak into the body', () => {
    const report = analyzeDocumentQuality({
      contents: [
        '# Final Report\n\n## Executive Summary\n\nThis reader-facing summary explains the recommendation and its supporting rationale in sufficient detail for review.\n\n## Evidence Matrix\n\n| Claim | Source |\n|---|---|\n| Internal audit detail | source.pdf |\n\n## Conclusion\n\nThe final recommendation remains bounded by the cited source and stated conditions.',
      ],
      strict: true,
    });

    expect(report.issues).toContain('正文包含内部审计或编制过程内容。');
    expect(report.passed).toBe(false);
    expect(report.metrics.internalControlMarkerCount).toBeGreaterThan(0);
  });

  test('flags table-heavy prose when the deliverable is not a table-led register', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `| Item ${index + 1} | Value ${index + 1} |`).join('\n');
    const report = analyzeDocumentQuality({
      contents: [`# Analysis\n\n## Findings\n\n| Item | Value |\n|---|---|\n${rows}\n\n## Conclusion\n\nThe narrative conclusion explains the material implications, limitations, and recommended next steps for the reader.`],
      strict: true,
    });

    expect(report.issues).toContain('表格占比过高，正文叙述不足。');
    expect(report.metrics.tableLineRatio).toBeGreaterThan(0.45);
  });

  test('allows a table-led register to exceed the normal table ratio', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `| Risk ${index + 1} | Owner ${index + 1} |`).join('\n');
    const report = analyzeDocumentQuality({
      contents: [`# Risk Register\n\n## Register\n\n| Risk | Owner |\n|---|---|\n${rows}\n\n## Notes\n\nThis register is intentionally table-led and includes concise ownership notes for each recorded risk.`],
      strict: true,
      tableLed: true,
    });

    expect(report.issues).not.toContain('表格占比过高，正文叙述不足。');
  });

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
        internalControlMarkerCount: 0,
        tableLineRatio: 0.1,
      },
    };

    expect(formatDocumentQualityReport(report)).toContain('visuals=88, template=82');
  });
});
