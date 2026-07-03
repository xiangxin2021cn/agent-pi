import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

export type TemplateSourceType = 'markdown' | 'docx' | 'pdf';
export type TemplateLayoutFidelity = 'semantic-only' | 'strict-docx-ooxml' | 'pdf-visual-approximation';

export interface ExtractedTemplateProfile {
  id: string;
  sourcePath: string;
  sourceType: TemplateSourceType;
  generatedBy?: string;
  layoutFidelity: TemplateLayoutFidelity;
  sectionOrder: string[];
  titleDepth?: number;
  averageSectionLength?: number;
  tableConvention?: string;
  figureConvention?: string;
  citationStyle?: string;
  languageStyle?: string;
  pageSize?: 'A4' | 'A3' | 'letter' | 'custom';
  orientation?: 'portrait' | 'landscape';
  styles: Array<{
    id: string;
    name: string;
    role?: 'title' | 'heading' | 'body' | 'caption' | 'table' | 'toc' | 'header' | 'footer';
  }>;
  fonts: string[];
  tableStyles?: string[];
  captionStyles?: string[];
  headerFooterReferences?: Array<{
    type: 'header' | 'footer';
    id: string;
  }>;
  numbering?: Array<{
    id: string;
    levels: number;
  }>;
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  unknowns: string[];
}

export interface MarkdownTemplateProfileOptions {
  sourcePath: string;
  generatedBy?: string;
}

export interface DocxTemplateProfileOptions {
  sourcePath: string;
  strictLayout?: boolean;
  semanticMarkdown?: string;
}

export interface PdfTemplateProfileOptions {
  sourcePath: string;
  pageSize?: 'A4' | 'A3' | 'letter' | 'custom';
}

export function extractMarkdownTemplateProfile(markdown: string, options: MarkdownTemplateProfileOptions): ExtractedTemplateProfile {
  const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(match => ({
    depth: match[1]!.length,
    text: match[2]!.trim(),
  }));

  return {
    id: profileId(options.sourcePath, markdown),
    sourcePath: options.sourcePath,
    sourceType: 'markdown',
    generatedBy: options.generatedBy,
    layoutFidelity: 'semantic-only',
    sectionOrder: headings.map(heading => heading.text),
    titleDepth: headings[0]?.depth,
    averageSectionLength: averageSectionLength(markdown, headings.length),
    tableConvention: /\|.+\|[\r\n]+\|?\s*:?-{3,}/.test(markdown) ? 'markdown-pipe-table' : undefined,
    figureConvention: /!\[[^\]]*]\([^)]+\)/.test(markdown) ? 'markdown-image' : undefined,
    citationStyle: detectCitationStyle(markdown),
    languageStyle: detectLanguageStyle(markdown),
    styles: headings.map(heading => ({
      id: `markdown-h${heading.depth}`,
      name: `Heading ${heading.depth}`,
      role: heading.depth === 1 ? 'title' : 'heading',
    })),
    fonts: [],
    unknowns: ['Exact page layout and Word styles are unavailable from Markdown templates.'],
  };
}

export function extractDocxTemplateProfile(docxBytes: Buffer | Uint8Array, options: DocxTemplateProfileOptions): ExtractedTemplateProfile {
  const files = unzipSync(new Uint8Array(docxBytes));
  const stylesXml = readZipText(files, 'word/styles.xml');
  const numberingXml = readZipText(files, 'word/numbering.xml');
  const documentXml = readZipText(files, 'word/document.xml');
  const styles = stylesXml ? extractStyles(stylesXml) : [];
  const semanticProfile = options.semanticMarkdown
    ? extractMarkdownTemplateProfile(options.semanticMarkdown, { sourcePath: `${options.sourcePath}.semantic.md`, generatedBy: 'markitdown' })
    : undefined;
  const page = documentXml ? extractPageProfile(documentXml) : {};
  const unknowns: string[] = [];

  if (!stylesXml) unknowns.push('DOCX styles.xml is missing; style fidelity is unknown.');
  if (!documentXml) unknowns.push('DOCX document.xml is missing; page and section properties are unknown.');
  if (!numberingXml) unknowns.push('DOCX numbering.xml is missing; numbering fidelity is unknown.');

  return {
    id: profileId(options.sourcePath, Buffer.from(docxBytes).toString('base64')),
    sourcePath: options.sourcePath,
    sourceType: 'docx',
    layoutFidelity: options.strictLayout ? 'strict-docx-ooxml' : 'semantic-only',
    sectionOrder: semanticProfile?.sectionOrder ?? [],
    pageSize: page.pageSize,
    orientation: page.orientation,
    margins: page.margins,
    styles,
    fonts: extractFonts(stylesXml ?? ''),
    tableStyles: styles.filter(style => style.role === 'table').map(style => style.id),
    captionStyles: styles.filter(style => style.role === 'caption').map(style => style.id),
    headerFooterReferences: documentXml ? extractHeaderFooterReferences(documentXml) : undefined,
    numbering: numberingXml ? extractNumbering(numberingXml) : undefined,
    unknowns,
  };
}

export function extractPdfTemplateProfile(text: string, options: PdfTemplateProfileOptions): ExtractedTemplateProfile {
  const headings = [...text.matchAll(/^(?:\d+(?:\.\d+)*\.?\s+)?([A-Z][^\n]{2,80})$/gm)].map(match => match[1]!.trim());
  return {
    id: profileId(options.sourcePath, text),
    sourcePath: options.sourcePath,
    sourceType: 'pdf',
    layoutFidelity: 'pdf-visual-approximation',
    sectionOrder: headings,
    titleDepth: headings.length > 0 ? 1 : undefined,
    tableConvention: /table\s+\d+|表\s*\d+/i.test(text) ? 'inferred-pdf-table' : undefined,
    figureConvention: /figure\s+\d+|图\s*\d+/i.test(text) ? 'inferred-pdf-figure' : undefined,
    citationStyle: detectCitationStyle(text),
    languageStyle: detectLanguageStyle(text),
    pageSize: options.pageSize,
    styles: [],
    fonts: [],
    unknowns: [
      'Exact Word styles are unavailable from PDF-only templates.',
      'PDF template fidelity is limited to visual approximation and semantic structure.',
    ],
  };
}

export function saveTemplateProfile(profile: ExtractedTemplateProfile, targetDir: string): string {
  mkdirSync(targetDir, { recursive: true });
  const outputPath = join(targetDir, 'template-profile.json');
  writeFileSync(outputPath, JSON.stringify(profile, null, 2), 'utf-8');
  return outputPath;
}

function extractStyles(stylesXml: string): ExtractedTemplateProfile['styles'] {
  return [...stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)]
    .map(match => {
      const block = match[0];
      const id = match[1]!;
      const name = block.match(/<w:name\b[^>]*w:val="([^"]+)"/)?.[1] ?? id;
      return {
        id,
        name,
        role: styleRole(id, name),
      };
    });
}

function styleRole(id: string, name: string): ExtractedTemplateProfile['styles'][number]['role'] {
  const value = `${id} ${name}`.toLowerCase();
  if (/title/.test(value)) return 'title';
  if (/heading/.test(value)) return 'heading';
  if (/caption/.test(value)) return 'caption';
  if (/table/.test(value)) return 'table';
  if (/toc/.test(value)) return 'toc';
  if (/header/.test(value)) return 'header';
  if (/footer/.test(value)) return 'footer';
  return 'body';
}

function extractFonts(stylesXml: string): string[] {
  return [...new Set([...stylesXml.matchAll(/w:(?:ascii|eastAsia|hAnsi)="([^"]+)"/g)].map(match => match[1]!))];
}

function extractNumbering(numberingXml: string): ExtractedTemplateProfile['numbering'] {
  return [...numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[\s\S]*?<\/w:abstractNum>/g)]
    .map(match => ({
      id: match[1]!,
      levels: [...match[0].matchAll(/<w:lvl\b/g)].length,
    }));
}

function extractHeaderFooterReferences(documentXml: string): ExtractedTemplateProfile['headerFooterReferences'] {
  return [...documentXml.matchAll(/<w:(headerReference|footerReference)\b[^>]*r:id="([^"]+)"/g)]
    .map(match => ({
      type: match[1] === 'headerReference' ? 'header' as const : 'footer' as const,
      id: match[2]!,
    }));
}

function extractPageProfile(documentXml: string): Pick<ExtractedTemplateProfile, 'pageSize' | 'orientation' | 'margins'> {
  const pageSizeMatch = documentXml.match(/<w:pgSz\b[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*(?:w:orient="([^"]+)")?[^>]*\/>/);
  const marginMatch = documentXml.match(/<w:pgMar\b[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/);
  const width = pageSizeMatch?.[1] ? Number.parseInt(pageSizeMatch[1], 10) : undefined;
  const height = pageSizeMatch?.[2] ? Number.parseInt(pageSizeMatch[2], 10) : undefined;

  return {
    pageSize: width && height ? classifyPageSize(width, height) : undefined,
    orientation: pageSizeMatch?.[3] === 'landscape' || (width && height && width > height) ? 'landscape' : 'portrait',
    margins: marginMatch ? {
      top: Number.parseInt(marginMatch[1]!, 10),
      right: Number.parseInt(marginMatch[2]!, 10),
      bottom: Number.parseInt(marginMatch[3]!, 10),
      left: Number.parseInt(marginMatch[4]!, 10),
    } : undefined,
  };
}

function classifyPageSize(width: number, height: number): ExtractedTemplateProfile['pageSize'] {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (near(shortSide, 11906) && near(longSide, 16838)) return 'A4';
  if (near(shortSide, 16838) && near(longSide, 23811)) return 'A3';
  if (near(shortSide, 12240) && near(longSide, 15840)) return 'letter';
  return 'custom';
}

function near(value: number, target: number): boolean {
  return Math.abs(value - target) < 80;
}

function readZipText(files: Record<string, Uint8Array>, path: string): string | undefined {
  const file = files[path];
  return file ? strFromU8(file) : undefined;
}

function detectCitationStyle(text: string): string | undefined {
  if (/^\s*\[\d+]\s+/m.test(text)) return 'numeric-bracket';
  if (/\([A-Z][A-Za-z-]+,\s*(?:19|20)\d{2}\)/.test(text)) return 'author-year';
  if (/https?:\/\//.test(text)) return 'url-inline';
  return undefined;
}

function detectLanguageStyle(text: string): string {
  return /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en';
}

function averageSectionLength(markdown: string, sectionCount: number): number | undefined {
  if (sectionCount === 0) return undefined;
  const textLength = markdown.replace(/^#{1,6}\s+.+$/gm, '').trim().length;
  return Math.round(textLength / sectionCount);
}

function profileId(sourcePath: string, content: string): string {
  return `tpl_${createHash('sha1').update(sourcePath).update(content).digest('hex').slice(0, 12)}`;
}
