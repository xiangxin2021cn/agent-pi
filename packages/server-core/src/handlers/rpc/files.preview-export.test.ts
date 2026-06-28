import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import xlsx from 'xlsx'
import { strFromU8, unzipSync } from 'fflate'
import {
  buildMarkdownExport,
  createSpreadsheetTablePreviewFromWorkbook,
  renderMarkdownBlocksForExport,
} from './files'

function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1')
  return [...raw.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((match) => {
      const bytes = Buffer.from(match[1], 'hex')
      let offset = bytes[0] === 0xFE && bytes[1] === 0xFF ? 2 : 0
      let text = ''
      for (; offset + 1 < bytes.length; offset += 2) {
        text += String.fromCharCode((bytes[offset] << 8) | bytes[offset + 1])
      }
      return text
    })
    .join('\n')
}

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-pi-preview-export-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('createSpreadsheetTablePreviewFromWorkbook', () => {
  it('returns bounded row and column data for spreadsheet overlays', () => {
    const workbook = xlsx.utils.book_new()
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['Item', 'Quantity'],
      ['Concrete', 42],
      ['Steel', 7],
    ])
    xlsx.utils.book_append_sheet(workbook, worksheet, 'BOQ')

    const preview = createSpreadsheetTablePreviewFromWorkbook(workbook, 'estimate.xlsx', 'estimate.xlsx')

    expect(preview.fileName).toBe('estimate.xlsx')
    expect(preview.sheets).toHaveLength(1)
    expect(preview.sheets[0].name).toBe('BOQ')
    expect(preview.sheets[0].columns.map(column => column.label)).toEqual(['A', 'B'])
    expect(preview.sheets[0].rows[0]).toEqual({ A: 'Item', B: 'Quantity' })
    expect(preview.sheets[0].rows[1]).toEqual({ A: 'Concrete', B: 42 })
  })
})

describe('buildMarkdownExport', () => {
  it('exports markdown content as HTML, DOCX, and PDF files', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = join(dir, 'analysis.md')
      const content = '# 分析报告\n\n**结论**：可行。\n\n- 工期：30 天\n- 依据：招标文件第 5 页'

      const html = await buildMarkdownExport({ sourcePath, content, format: 'html' })
      const docx = await buildMarkdownExport({ sourcePath, content, format: 'docx' })
      const pdf = await buildMarkdownExport({ sourcePath, content, format: 'pdf' })

      expect(existsSync(html.path)).toBe(true)
      expect(readFileSync(html.path, 'utf-8')).toContain('<h1>分析报告</h1>')
      expect(existsSync(docx.path)).toBe(true)
      const docxBytes = readFileSync(docx.path)
      expect(docxBytes.subarray(0, 2).toString()).toBe('PK')
      const docxXml = strFromU8(unzipSync(new Uint8Array(docxBytes))['word/document.xml']!)
      expect(docxXml).toContain('分析报告')
      expect(docxXml).toContain('结论：可行。')
      expect(docxXml).toContain('• 工期：30 天')
      expect(docxXml).not.toContain('# 分析报告')
      expect(docxXml).not.toContain('**结论**')
      expect(docxXml).not.toContain('- 工期')
      expect(existsSync(pdf.path)).toBe(true)
      const pdfBytes = readFileSync(pdf.path)
      expect(pdfBytes.toString('utf-8').startsWith('%PDF-1.4')).toBe(true)
      expect(statSync(pdf.path).size).toBeGreaterThan(500)
      const pdfText = extractPdfText(pdfBytes)
      expect(pdfText).toContain('分析报告')
      expect(pdfText).toContain('结论：可行。')
      expect(pdfText).toContain('工期：30 天')
      expect(pdfText).not.toContain('# 分析报告')
      expect(pdfText).not.toContain('**结论**')
      expect(pdfText).not.toContain('- 工期')
    })
  })

  it('normalizes markdown blocks before document export', () => {
    expect(renderMarkdownBlocksForExport('# Title\n\n- **Bold** item')).toEqual([
      { type: 'heading', depth: 1, text: 'Title' },
      { type: 'listItem', ordered: false, index: 1, text: 'Bold item' },
    ])
  })

  it('uses the host HTML renderer for PDF export when available', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = join(dir, 'rendered.md')
      const targetPath = join(dir, 'custom-name')
      let renderedHtml = ''

      const pdf = await buildMarkdownExport({
        sourcePath,
        targetPath,
        content: '# Rendered\n\n**Bold** text\n\n| A | B |\n| - | - |\n| 1 | 2 |',
        format: 'pdf',
        renderHtmlToPdf: async (html) => {
          renderedHtml = html
          return Buffer.from('%PDF-1.4\n% rendered by host\n%%EOF')
        },
      })

      expect(pdf.path).toBe(`${targetPath}.pdf`)
      expect(readFileSync(pdf.path, 'utf-8')).toContain('rendered by host')
      expect(renderedHtml).toContain('<h1>Rendered</h1>')
      expect(renderedHtml).toContain('<strong>Bold</strong> text')
      expect(renderedHtml).toContain('<table>')
      expect(renderedHtml).toContain('@page{size:A4')
      expect(renderedHtml).toContain('overflow-wrap:anywhere')
      expect(renderedHtml).not.toContain('# Rendered')
      expect(renderedHtml).not.toContain('**Bold**')
    })
  })
})
