import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import xlsx from 'xlsx'
import {
  buildMarkdownExport,
  createSpreadsheetTablePreviewFromWorkbook,
} from './files'

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
      const content = '# 分析报告\n\n- 工期：30 天\n- 依据：招标文件第 5 页'

      const html = await buildMarkdownExport({ sourcePath, content, format: 'html' })
      const docx = await buildMarkdownExport({ sourcePath, content, format: 'docx' })
      const pdf = await buildMarkdownExport({ sourcePath, content, format: 'pdf' })

      expect(existsSync(html.path)).toBe(true)
      expect(readFileSync(html.path, 'utf-8')).toContain('<h1>分析报告</h1>')
      expect(existsSync(docx.path)).toBe(true)
      expect(readFileSync(docx.path).subarray(0, 2).toString()).toBe('PK')
      expect(existsSync(pdf.path)).toBe(true)
      expect(readFileSync(pdf.path, 'utf-8').startsWith('%PDF-1.4')).toBe(true)
      expect(statSync(pdf.path).size).toBeGreaterThan(500)
    })
  })
})
