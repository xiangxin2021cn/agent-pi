import { describe, expect, test } from 'bun:test';
import { renderVisualMarkdownBlock } from './visual-markdown.ts';

describe('visual markdown block renderer', () => {
  test('renders editable Mermaid blocks with caption, source note, and audit reason', () => {
    const result = renderVisualMarkdownBlock({
      kind: 'mermaid',
      title: 'Approval Flow',
      mermaid: 'flowchart TD\n  A[Draft] --> B[Review]',
      caption: 'Figure 1. Approval workflow.',
      source: 'Project procedure section 3.',
      auditReason: 'Generated from explicit process steps.',
    });

    expect(result.markdown).toContain('```mermaid');
    expect(result.markdown).toContain('flowchart TD');
    expect(result.markdown).toContain('Figure 1. Approval workflow.');
    expect(result.markdown).toContain('Source: Project procedure section 3.');
    expect(result.markdown).not.toContain('Evidence:');
    expect(result.manifest[0]).toMatchObject({ kind: 'mermaid', title: 'Approval Flow' });
    expect(result.manifest[0]?.auditReason).toBe('Generated from explicit process steps.');
  });

  test('renders professional SVG assets as relative Markdown image blocks', () => {
    const result = renderVisualMarkdownBlock({
      kind: 'svg',
      title: 'Construction Gantt',
      assetPath: 'C:/project/output/assets/gantt.svg',
      outputDir: 'C:/project/output',
      caption: 'Figure 2. WBS-aware construction Gantt.',
      source: 'schedule.csv',
      auditReason: 'Baseline and current dates were present.',
    });

    expect(result.markdown).toContain('![Figure 2. WBS-aware construction Gantt.](assets/gantt.svg)');
    expect(result.markdown).toContain('Source: schedule.csv.');
    expect(result.manifest[0]?.relativePath).toBe('assets/gantt.svg');
  });

  test('renders professional table blocks and records raw sidecar paths', () => {
    const result = renderVisualMarkdownBlock({
      kind: 'table',
      title: 'Cash Flow Table',
      tableMarkdown: '| Year | Net Cash Flow |\n| --- | --- |\n| 2026 | (1,025,000) |',
      rawSidecarPath: 'tables/cash-flow.raw.json',
      caption: 'Table 1. Investment cash-flow assumptions.',
      source: 'model.xlsx',
      auditReason: 'Formatted from user-provided workbook data.',
    });

    expect(result.markdown).toContain('| Year | Net Cash Flow |');
    expect(result.markdown).toContain('Raw table: `tables/cash-flow.raw.json`.');
    expect(result.manifest[0]?.rawSidecarPath).toBe('tables/cash-flow.raw.json');
  });
});
