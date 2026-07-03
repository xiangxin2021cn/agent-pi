import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  extractDocxTemplateProfile,
  extractMarkdownTemplateProfile,
  extractPdfTemplateProfile,
  saveTemplateProfile,
} from './template-profile.ts';

describe('template profile extractor', () => {
  test('extracts semantic structure from Markdown templates', () => {
    const profile = extractMarkdownTemplateProfile([
      '# Tender Report Template',
      '',
      '## Executive Summary',
      'Short management summary paragraph.',
      '',
      '## Cost Table',
      '| Item | Amount |',
      '| --- | ---: |',
      '| Total | 100 |',
      '',
      '![Figure 1](figure.png)',
      '',
      '[1] Source reference style.',
    ].join('\n'), { sourcePath: 'template.md' });

    expect(profile.sourceType).toBe('markdown');
    expect(profile.sectionOrder).toEqual(['Tender Report Template', 'Executive Summary', 'Cost Table']);
    expect(profile.titleDepth).toBe(1);
    expect(profile.tableConvention).toBe('markdown-pipe-table');
    expect(profile.figureConvention).toBe('markdown-image');
    expect(profile.citationStyle).toBe('numeric-bracket');
  });

  test('handles markitdown-generated semantic templates without claiming exact layout fidelity', () => {
    const profile = extractMarkdownTemplateProfile('# Converted\n\n## Section\n\nText', {
      sourcePath: 'template.markitdown.md',
      generatedBy: 'markitdown',
    });

    expect(profile.generatedBy).toBe('markitdown');
    expect(profile.layoutFidelity).toBe('semantic-only');
  });

  test('extracts DOCX OOXML style metadata for strict layout profiles', () => {
    const docx = zipSync({
      'word/styles.xml': strToU8([
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:style>',
        '<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>',
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>',
        '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/></w:style>',
        '</w:styles>',
      ].join('')),
      'word/numbering.xml': strToU8('<w:numbering><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"/></w:abstractNum></w:numbering>'),
      'word/document.xml': strToU8([
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
        '</w:body></w:document>',
      ].join('')),
    });

    const profile = extractDocxTemplateProfile(Buffer.from(docx), {
      sourcePath: 'strict-template.docx',
      strictLayout: true,
      semanticMarkdown: '# Tender Template\n\n## Executive Summary',
    });

    expect(profile.sourceType).toBe('docx');
    expect(profile.layoutFidelity).toBe('strict-docx-ooxml');
    expect(profile.pageSize).toBe('A4');
    expect(profile.orientation).toBe('landscape');
    expect(profile.styles.map(style => style.id)).toEqual(expect.arrayContaining(['Heading1', 'BodyText']));
    expect(profile.sectionOrder).toEqual(['Tender Template', 'Executive Summary']);
    expect(profile.fonts).toContain('Arial');
    expect(profile.numbering?.[0]).toMatchObject({ id: '1', levels: 1 });
    expect(profile.margins?.left).toBe(1440);
    expect(profile.tableStyles).toContain('TableGrid');
    expect(profile.captionStyles).toContain('Caption');
    expect(profile.headerFooterReferences).toEqual(expect.arrayContaining([
      { type: 'header', id: 'rIdHeader1' },
      { type: 'footer', id: 'rIdFooter1' },
    ]));
  });

  test('labels PDF templates as visual approximations and leaves unknown metadata unknown', () => {
    const profile = extractPdfTemplateProfile('Project Report\n\n1. Overview\n\nTable 1 Cost Summary', {
      sourcePath: 'template.pdf',
      pageSize: 'A3',
    });

    expect(profile.sourceType).toBe('pdf');
    expect(profile.layoutFidelity).toBe('pdf-visual-approximation');
    expect(profile.pageSize).toBe('A3');
    expect(profile.unknowns).toContain('Exact Word styles are unavailable from PDF-only templates.');
  });

  test('saves compact profile JSON next to session or project metadata', () => {
    const dir = join(tmpdir(), `template-profile-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const profile = extractMarkdownTemplateProfile('# Template', { sourcePath: 'template.md' });
      const path = saveTemplateProfile(profile, dir);

      expect(path.endsWith('template-profile.json')).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf-8')).id).toBe(profile.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
