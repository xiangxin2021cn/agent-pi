import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import xlsx from 'xlsx'
import { createSpreadsheetMarkdownPreview, createSpreadsheetMarkdownPreviewFromWorkbook } from './files'

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'agent-pi-office-preview-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createWorkbook(ref: string): xlsx.WorkBook {
  const workbook = xlsx.utils.book_new()
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['Item', 'Quantity'],
    ['Concrete', 42],
  ])
  worksheet['!ref'] = ref
  xlsx.utils.book_append_sheet(workbook, worksheet, 'BOQ')
  return workbook
}

function writeWorkbook(path: string): void {
  xlsx.writeFile(createWorkbook('A1:B2'), path)
}

describe('createSpreadsheetMarkdownPreview', () => {
  it('skips unsafe full conversion for workbooks with polluted used ranges', () => {
    const workbook = createWorkbook('A1:XFA1048332')

    const started = performance.now()
    const preview = createSpreadsheetMarkdownPreviewFromWorkbook(workbook, 'polluted.xlsx', 'polluted.xlsx')
    const elapsedMs = performance.now() - started

    expect(elapsedMs).toBeLessThan(2_000)
    expect(preview.fullConversionAllowed).toBe(false)
    expect(preview.reason).toContain('oversized declared ranges')
    expect(preview.textContent).toContain('Full spreadsheet-to-Markdown conversion was skipped')
    expect(preview.textContent).toContain('XFA1048332')
    expect(preview.textContent).toContain('Concrete')
  })

  it('generates bounded markdown preview for normal spreadsheets', () => {
    withTempDir((dir) => {
      const filePath = join(dir, 'normal.xlsx')
      writeWorkbook(filePath)

      const preview = createSpreadsheetMarkdownPreview(filePath, 'normal.xlsx')

      expect(preview.fullConversionAllowed).toBe(true)
      expect(preview.textContent).toContain('bounded spreadsheet preview')
      expect(preview.textContent).toContain('A1:B2')
      expect(preview.textContent).toContain('Item')
      expect(preview.textContent).toContain('Concrete')
    })
  })
})
