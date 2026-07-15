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

  test('detects numbered evidence matrices and orchestration metadata as internal leakage', () => {
    const report = analyzeDocumentQuality({
      contents: [
        '# 技术争议分析备忘录\n\n## 一、结论\n\n现有资料只能支持条件性结论，最终判断仍应回到合同条款、产品类型和实际缺陷记录。\n\n### 3.3 证据矩阵\n\n| 主张 | 来源 |\n|---|---|\n| 内部核验记录 | source.pdf |\n\n## 附录：跨 Agent 一致性审查\n\nSession ID: 260714-open-fjord\n\nhandoff_ready，内部文件位于 C:\\\\Users\\\\xiang\\\\.agent-pi\\\\session。',
      ],
      strict: true,
    });

    expect(report.issues).toContain('正文包含内部审计或编制过程内容。');
    expect(report.passed).toBe(false);
    expect(report.metrics.internalControlMarkerCount).toBeGreaterThanOrEqual(2);
  });

  test('enforces narrative budgets for a technical dispute memo', () => {
    const table = (name: string) => `| ${name} | 结论 |\n|---|---|\n| 条件 | 判断 |`;
    const report = analyzeDocumentQuality({
      contents: [`# 争议分析\n\n## 结论\n\n应依据合同和实测结果判断，不能仅以笼统外观意见拒收。\n\n${table('规范')}\n\n${table('合同')}\n\n${table('行动')}\n\n## 说明\n\n正文虽然存在，但三张表格已经超过本类备忘录的必要表达范围。`],
      strict: true,
      editorialProfile: {
        genre: 'technical_dispute_memo',
        readerDecision: 'Resolve the dispute.',
        narrativeFirst: true,
        maxHeadings: 12,
        maxTables: 2,
        maxTableLineRatio: 0.25,
      },
    });

    expect(report.issues).toContain('表格数量超过当前文体预算，影响连续阅读。');
    expect(report.passed).toBe(false);
    expect(report.metrics.tableCount).toBe(3);
  });

  test('does not count numbered action prose as document headings', () => {
    const report = analyzeDocumentQuality({
      contents: [
        '# 技术备忘录\n\n## 适用依据\n\n1. **合同验收条款**\n\n条款要求应结合产品性能和实测结果解释。\n\n## 建议行动\n\n1. **索要书面通知**：要求工程师列明具体条款、缺陷记录和拒收依据。\n2. **完成技术核验**：核对尺寸、承载能力、耐久性和功能性测试记录。\n3. **保留合同权利**：在整改与争议程序中持续保留工期和费用权利。',
      ],
    });

    expect(report.metrics.headingCount).toBe(4);
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
        tableCount: 1,
        placeholderCount: 0,
        internalControlMarkerCount: 0,
        tableLineRatio: 0.1,
      },
    };

    expect(formatDocumentQualityReport(report)).toContain('visuals=88, template=82');
  });
});
