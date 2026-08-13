import { describe, expect, test } from 'bun:test';
import { analyzeWritingCraft } from './writing-craft.ts';

const grounded = `# 解析纪要

本合同 Particular Conditions 第 8.7 款将误期赔偿金定为每天合同额 0.05%，上限 10%。组价须把该上限写入风险准备金，不得把罚则写成空泛保证。

缺口：Addendum 2 未给出夜间封闭是否计入补偿，需澄清后再锁交通疏解单价。`;

describe('analyzeWritingCraft', () => {
  test('fails fluent filler that still looks like a complete report', () => {
    const report = analyzeWritingCraft({
      strict: true,
      contents: [`# 综合分析报告

综上所述，本项目将赋能投标、全方位覆盖评标要点。Furthermore, it is important to note that our robust and seamless solution leverages cutting-edge practices.

## Key Takeaways
- 首先，全面梳理资料
- 其次，系统分析风险
- 最后，确保万无一失`],
    });
    expect(report.passed).toBe(false);
    expect(report.metrics.fillerHitCount).toBeGreaterThan(2);
    expect(report.issues.some((issue) => issue.includes('套话') || issue.includes('filler'))).toBe(true);
  });

  test('fails catalog / pack-path tone', () => {
    const report = analyzeWritingCraft({
      strict: true,
      contents: [`# 分析范围

documentId: doc-12。Working Folder 见 Agent Pi Outputs/260808-wild-laurel。请先阅读 pack 路径 orchestration/briefs。`],
    });
    expect(report.passed).toBe(false);
    expect(report.metrics.catalogHitCount).toBeGreaterThan(0);
  });

  test('passes a judgment-first memo with locators and no filler', () => {
    const report = analyzeWritingCraft({ strict: true, contents: [grounded] });
    expect(report.passed).toBe(true);
    expect(report.metrics.judgmentHitCount).toBeGreaterThan(0);
    expect(report.metrics.fillerHitCount).toBe(0);
  });
});
