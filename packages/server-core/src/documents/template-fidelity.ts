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

  if (profile.sourceType === 'docx' && profile.layoutFidelity === 'strict-docx-ooxml' && !options.exportedDocxProfile) {
    score -= 20;
    issues.push('Strict DOCX template audit requires exported DOCX structure evidence.');
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
      layoutApproximation: approximation ? 65 : 85,
      headingPattern: profile.titleDepth && headings[0]?.depth === profile.titleDepth ? 90 : 55,
      depth: issues.some(issue => issue.includes('too shallow')) ? 55 : 85,
      visualConventions: issues.some(issue => issue.includes('caption convention')) ? 55 : 85,
      evidence: citationStyleMatches(markdown, profile.citationStyle) ? 85 : 55,
      exportReadiness: profile.sourceType === 'docx' && profile.layoutFidelity === 'strict-docx-ooxml' && !options.exportedDocxProfile ? 45 : 80,
    },
  };
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

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
