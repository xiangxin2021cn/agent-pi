import { suggestVisuals } from '@craft-agent/shared/document-visuals';
import type { VisualOpportunity, VisualRegistryInput } from '@craft-agent/shared/document-visuals';

export interface VisualOpportunityAnalysis {
  opportunities: VisualOpportunity[];
  existingVisualCount: number;
  capped: boolean;
}

export interface VisualOpportunityOptions {
  mode?: 'standard' | 'professional';
  maxVisuals?: number;
}

interface MarkdownSection {
  heading: string;
  content: string;
  startLine: number;
}

const MERMAID_BLOCK_PATTERN = /```mermaid[\s\S]*?```/gi;
const IMAGE_PATTERN = /!\[[^\]]*]\([^)]+\)/g;
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function detectVisualOpportunities(markdown: string, options: VisualOpportunityOptions = {}): VisualOpportunity[] {
  return analyzeVisualOpportunities(markdown, options).opportunities;
}

export function analyzeVisualOpportunities(markdown: string, options: VisualOpportunityOptions = {}): VisualOpportunityAnalysis {
  const maxVisuals = options.maxVisuals ?? (options.mode === 'professional' ? 12 : 5);
  const sections = parseMarkdownSections(markdown);
  const opportunities: VisualOpportunity[] = [];
  let existingVisualCount = 0;

  for (const section of sections) {
    const existingInSection = countExistingVisuals(section.content);
    existingVisualCount += existingInSection;
    if (existingInSection > 0) continue;

    const input: VisualRegistryInput = {
      text: `${section.heading}\n${stripMarkdownTables(section.content)}`.trim(),
      tables: extractMarkdownTables(section.content).flat(),
      mode: options.mode,
    };

    const suggestions = suggestVisuals(input);
    for (const suggestion of suggestions) {
      opportunities.push({
        id: `visual-${section.startLine}-${opportunities.length + 1}`,
        domain: suggestion.domain,
        recommendedKind: suggestion.kind,
        score: suggestion.score,
        reason: suggestion.reason,
        requiredData: suggestion.requiredData,
        missingData: suggestion.missingData,
      });

      if (opportunities.length >= maxVisuals) {
        return {
          opportunities,
          existingVisualCount,
          capped: true,
        };
      }
    }
  }

  return {
    opportunities,
    existingVisualCount,
    capped: false,
  };
}

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let heading = '';
  let startLine = 1;
  let buffer: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^#{1,6}\s+/.test(line)) {
      if (heading || buffer.some(item => item.trim())) {
        sections.push({ heading, content: buffer.join('\n'), startLine });
      }
      heading = line.replace(/^#{1,6}\s+/, '').trim();
      startLine = index + 1;
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  if (heading || buffer.some(item => item.trim())) {
    sections.push({ heading, content: buffer.join('\n'), startLine });
  }

  return sections;
}

function countExistingVisuals(markdown: string): number {
  return countMatches(markdown, MERMAID_BLOCK_PATTERN) + countMatches(markdown, IMAGE_PATTERN);
}

function countMatches(input: string, pattern: RegExp): number {
  const matches = input.match(pattern);
  return matches?.length ?? 0;
}

function extractMarkdownTables(markdown: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] = [];

  for (const line of markdown.split(/\r?\n/)) {
    if (isTableLine(line)) {
      if (!TABLE_SEPARATOR_PATTERN.test(line)) {
        current.push(splitTableRow(line));
      }
      continue;
    }

    if (current.length > 0) {
      tables.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    tables.push(current);
  }

  return tables;
}

function stripMarkdownTables(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter(line => !isTableLine(line))
    .join('\n');
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}
