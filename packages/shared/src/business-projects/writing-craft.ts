import {
  WRITING_CATALOG_PATTERN,
  WRITING_FILLER_PATTERN,
  WRITING_JUDGMENT_PATTERN,
  WRITING_SKELETON_PATTERN,
} from './writing-filler.ts';

export interface WritingCraftReport {
  passed: boolean;
  score: number;
  issues: string[];
  strengths: string[];
  metrics: {
    fillerHitCount: number;
    skeletonHitCount: number;
    catalogHitCount: number;
    judgmentHitCount: number;
    fillerDensity: number;
  };
}

export function analyzeWritingCraft(input: {
  contents: string[];
  strict?: boolean;
}): WritingCraftReport {
  const raw = input.contents.map(content => content.trim()).filter(Boolean).join('\n\n');
  const charCount = Math.max(raw.length, 1);
  const fillerHitCount = countMatches(raw, WRITING_FILLER_PATTERN);
  const skeletonHitCount = countMatches(raw, WRITING_SKELETON_PATTERN);
  const catalogHitCount = countMatches(raw, WRITING_CATALOG_PATTERN);
  const judgmentHitCount = countMatches(raw, WRITING_JUDGMENT_PATTERN);
  const fillerDensity = fillerHitCount / charCount;

  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  const fillerPenalty = Math.min(40, fillerHitCount * 8);
  score -= fillerPenalty;
  if (fillerHitCount > 0) {
    issues.push(`正文含 AI 套话或营销腔（${fillerHitCount} 处）。`);
  }

  score -= skeletonHitCount * 12;
  if (skeletonHitCount > 0) {
    issues.push('正文使用空骨架结构（Key Takeaways / 首先-其次-最后）。');
  }

  score -= catalogHitCount * 15;
  if (catalogHitCount > 0) {
    issues.push('正文是文件目录或 pack 路径说明，不是给读者的判断。');
  }

  if (input.strict && fillerDensity > 0.004) {
    score -= 10;
    issues.push('套话密度过高，需要按撰写 skill 重写。');
  }

  if (raw.length >= 400 && judgmentHitCount === 0) {
    score -= 20;
    issues.push('篇幅足够但缺少判断句（应/须/不得/缺口等）。');
  } else if (judgmentHitCount > 0 && fillerHitCount === 0) {
    strengths.push('正文含可执行判断，且未见套话。');
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const threshold = input.strict ? 80 : 70;
  const passed = clampedScore >= threshold
    && catalogHitCount === 0
    && (!input.strict || fillerHitCount === 0);

  return {
    passed,
    score: clampedScore,
    issues,
    strengths,
    metrics: {
      fillerHitCount,
      skeletonHitCount,
      catalogHitCount,
      judgmentHitCount,
      fillerDensity,
    },
  };
}

function countMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...content.matchAll(new RegExp(pattern.source, flags))].length;
}
