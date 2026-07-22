import type { ExtractedTemplateProfile } from './template-profile.ts';

export interface TemplateFidelityAuditOptions {
  exportedDocxProfile?: ExtractedTemplateProfile;
}

export interface TemplateFidelityAudit {
  passed: boolean;
  score: number;
  issues: string[];
  strengths: string[];
  approximation: boolean;
  dimensions: {
    structure: number;
    layoutApproximation: number;
    headingPattern: number;
    depth: number;
    visualConventions: number;
    evidence: number;
    exportReadiness: number;
  };
}

interface Heading {
  depth: number;
  text: string;
  index: number;
}

export function auditTemplateFidelity(
  markdown: string,
  profile: ExtractedTemplateProfile,
  options: TemplateFidelityAuditOptions = {},
): TemplateFidelityAudit {
  const headings = parseHeadings(markdown);
  const issues: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  if (profile.titleDepth && headings[0]?.depth !== profile.titleDepth) {
    score -= 10;
    issues.push(`Heading depth does not match template title depth ${profile.titleDepth}.`);
  } else if (profile.titleDepth) {
    strengths.push('Heading depth matches the template.');
  }

  for (const section of profile.sectionOrder) {
    if (!headings.some(heading => normalize(heading.text) === normalize(section))) {
      score -= 15;
      issues.push(`Missing required template section: ${section}.`);
    }
  }

  if (!requiredSectionsFollowTemplateOrder(headings, profile.sectionOrder)) {
    score -= 15;
    issues.push('Required sections do not follow the template order.');
  } else if (profile.sectionOrder.length > 1) {
    strengths.push('Required sections follow the template order.');
  }

  for (const heading of headings) {
    const sectionText = getSectionText(markdown, headings, heading);
    if (profile.sectionOrder.some(section => normalize(section) === normalize(heading.text)) && sectionText.replace(/\s+/g, ' ').trim().length < 40) {
      score -= 8;
      issues.push(`Section "${heading.text}" is too shallow for the reference template.`);
    }
  }

  if (!visualCaptionsMatch(markdown, profile)) {
    score -= 10;
    issues.push('Table or figure caption convention does not match the template.');
  } else if (profile.tableConvention || profile.figureConvention) {
    strengths.push('Visual caption conventions match the template.');
  }

  if (!citationStyleMatches(markdown, profile.citationStyle)) {
    score -= 10;
    issues.push(`Citation style does not match template style ${profile.citationStyle}.`);
  } else if (profile.citationStyle) {
    strengths.push('Citation style matches the template.');
  }

  const strictDocx = profile.sourceType === 'docx' && profile.layoutFidelity === 'strict-docx-ooxml';
  if (strictDocx && isUnresolvedStrictTemplateProfile(profile)) {
    score -= 20;
    issues.push('Strict template source profile is unresolved; the uploaded template must be parsed before completion.');
  }

  if (strictDocx && !options.exportedDocxProfile) {
    score -= 20;
    issues.push('Strict DOCX template audit requires exported DOCX structure evidence.');
  } else if (strictDocx && options.exportedDocxProfile) {
    const docxIssues = compareStrictDocxProfiles(profile, options.exportedDocxProfile);
    score -= docxIssues.length * 8;
    issues.push(...docxIssues);
    if (docxIssues.length === 0) strengths.push('Exported DOCX layout and style profile matches the template.');
  }

  const approximation = profile.sourceType === 'pdf' || profile.layoutFidelity === 'pdf-visual-approximation';
  if (approximation) {
    issues.push('PDF template fidelity is a visual approximation, not Word-level layout matching.');
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  return {
    passed: clampedScore >= 75 && issues.filter(issue => !issue.startsWith('PDF template fidelity')).length === 0,
    score: clampedScore,
    issues,
    strengths,
    approximation,
    dimensions: {
      structure: scoreStructure(headings, profile),
      layoutApproximation: approximation ? 65 : issues.some(issue => issue.startsWith('Exported DOCX')) ? 45 : 85,
      headingPattern: profile.titleDepth && headings[0]?.depth === profile.titleDepth ? 90 : 55,
      depth: issues.some(issue => issue.includes('too shallow')) ? 55 : 85,
      visualConventions: issues.some(issue => issue.includes('caption convention')) ? 55 : 85,
      evidence: citationStyleMatches(markdown, profile.citationStyle) ? 85 : 55,
      exportReadiness: profile.sourceType === 'docx' && profile.layoutFidelity === 'strict-docx-ooxml' && !options.exportedDocxProfile ? 45 : 80,
    },
  };
}

function isUnresolvedStrictTemplateProfile(profile: ExtractedTemplateProfile): boolean {
  return profile.id === 'template-request'
    || profile.sourcePath === 'user-template-request'
    || profile.unknowns.some(item => /pending parsed DOCX profile|exact source template profile is unavailable/i.test(item));
}

function parseHeadings(markdown: string): Heading[] {
  return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(match => ({
    depth: match[1]!.length,
    text: match[2]!.trim(),
    index: match.index ?? 0,
  }));
}

function getSectionText(markdown: string, headings: Heading[], heading: Heading): string {
  const next = headings.find(candidate => candidate.index > heading.index);
  const start = heading.index + markdown.slice(heading.index).indexOf('\n');
  return markdown.slice(start, next?.index);
}

function visualCaptionsMatch(markdown: string, profile: ExtractedTemplateProfile): boolean {
  const hasTable = /\|.+\|[\r\n]+\|?\s*:?-{3,}/.test(markdown);
  const hasImage = /!\[[^\]]*]\([^)]+\)/.test(markdown);
  const needsTableCaption = profile.tableConvention && hasTable;
  const needsFigureCaption = profile.figureConvention && hasImage;
  const tableOk = !needsTableCaption || /(?:Table|表)\s*\d+/i.test(markdown);
  const figureOk = !needsFigureCaption || /(?:Figure|图)\s*\d+/i.test(markdown);
  return tableOk && figureOk;
}

function citationStyleMatches(markdown: string, citationStyle: string | undefined): boolean {
  if (!citationStyle) return true;
  if (citationStyle === 'numeric-bracket') return /\[\d+]/.test(markdown);
  if (citationStyle === 'author-year') return /\([A-Z][A-Za-z-]+,\s*(?:19|20)\d{2}\)/.test(markdown);
  if (citationStyle === 'url-inline') return /https?:\/\//.test(markdown);
  return true;
}

function scoreStructure(headings: Heading[], profile: ExtractedTemplateProfile): number {
  if (profile.sectionOrder.length === 0) return headings.length > 0 ? 75 : 55;
  const matched = profile.sectionOrder.filter(section => headings.some(heading => normalize(heading.text) === normalize(section))).length;
  return Math.round((matched / profile.sectionOrder.length) * 100);
}

function requiredSectionsFollowTemplateOrder(headings: Heading[], sectionOrder: string[]): boolean {
  if (sectionOrder.length < 2) return true;
  const positions = sectionOrder.map(section => headings.findIndex(heading => normalize(heading.text) === normalize(section)));
  if (positions.some(position => position < 0)) return true;
  return positions.every((position, index) => index === 0 || position > positions[index - 1]!);
}

function compareStrictDocxProfiles(
  expected: ExtractedTemplateProfile,
  exported: ExtractedTemplateProfile,
): string[] {
  const issues: string[] = [];
  if (expected.pageSize && expected.pageSize !== exported.pageSize) {
    issues.push('Exported DOCX page size does not match the template.');
  }
  if (expected.orientation && expected.orientation !== exported.orientation) {
    issues.push('Exported DOCX orientation does not match the template.');
  }
  if (expected.margins && !marginsMatch(expected.margins, exported.margins)) {
    issues.push('Exported DOCX margins do not match the template.');
  }
  const exportedFonts = new Set(exported.fonts.map(value => normalize(value)));
  if (expected.fonts.some(font => !exportedFonts.has(normalize(font)))) {
    issues.push('Exported DOCX fonts do not include all template fonts.');
  }
  const exportedStyleIds = new Set(exported.styles.map(style => normalize(style.id)));
  if (expected.styles.some(style => !exportedStyleIds.has(normalize(style.id)))) {
    issues.push('Exported DOCX styles do not include all required template styles.');
  }
  if (!includesAllNormalized(exported.tableStyles, expected.tableStyles)) {
    issues.push('Exported DOCX table styles do not include all template table styles.');
  }
  if (!includesAllNormalized(exported.captionStyles, expected.captionStyles)) {
    issues.push('Exported DOCX caption styles do not include all template caption styles.');
  }
  if (!headerFooterStructureMatches(expected.headerFooterReferences, exported.headerFooterReferences)) {
    issues.push('Exported DOCX header/footer structure does not match the template.');
  }
  if (!numberingStructureMatches(expected.numbering, exported.numbering)) {
    issues.push('Exported DOCX numbering structure does not match the template.');
  }
  return issues;
}

function includesAllNormalized(exported: string[] | undefined, expected: string[] | undefined): boolean {
  if (!expected?.length) return true;
  const values = new Set((exported ?? []).map(normalize));
  return expected.every(value => values.has(normalize(value)));
}

function headerFooterStructureMatches(
  expected: ExtractedTemplateProfile['headerFooterReferences'],
  exported: ExtractedTemplateProfile['headerFooterReferences'],
): boolean {
  if (!expected?.length) return true;
  const countByType = (items: NonNullable<ExtractedTemplateProfile['headerFooterReferences']>) => ({
    header: items.filter(item => item.type === 'header').length,
    footer: items.filter(item => item.type === 'footer').length,
  });
  const expectedCount = countByType(expected);
  const exportedCount = countByType(exported ?? []);
  return expectedCount.header === exportedCount.header && expectedCount.footer === exportedCount.footer;
}

function numberingStructureMatches(
  expected: ExtractedTemplateProfile['numbering'],
  exported: ExtractedTemplateProfile['numbering'],
): boolean {
  if (!expected?.length) return true;
  const expectedLevels = expected.map(item => item.levels).sort((left, right) => left - right);
  const exportedLevels = (exported ?? []).map(item => item.levels).sort((left, right) => left - right);
  return expectedLevels.length === exportedLevels.length
    && expectedLevels.every((value, index) => value === exportedLevels[index]);
}

function marginsMatch(
  expected: NonNullable<ExtractedTemplateProfile['margins']>,
  exported: ExtractedTemplateProfile['margins'],
): boolean {
  if (!exported) return false;
  return (['top', 'right', 'bottom', 'left'] as const).every(side => {
    const expectedValue = expected[side];
    if (expectedValue === undefined) return true;
    const exportedValue = exported[side];
    return exportedValue !== undefined && Math.abs(expectedValue - exportedValue) <= 40;
  });
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
