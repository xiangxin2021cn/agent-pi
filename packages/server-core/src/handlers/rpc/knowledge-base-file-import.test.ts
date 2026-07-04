import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareKnowledgeBaseFileForImport } from './knowledge-base-file-import'

describe('prepareKnowledgeBaseFileForImport', () => {
  test('uses supported text files directly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-import-'))
    try {
      const filePath = join(root, 'standard.md')
      writeFileSync(filePath, '# Standard\n\nKeep source stable.', 'utf-8')

      const prepared = await prepareKnowledgeBaseFileForImport({
        filePath,
        appRootPath: join(root, 'app'),
      })

      expect(prepared.filePath).toBe(filePath)
      expect(prepared.originalSourceFilePath).toBe(filePath)
      expect(prepared.wasStructured).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wraps csv files into a structured markdown import sidecar', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-import-'))
    try {
      const filePath = join(root, 'cost.csv')
      writeFileSync(filePath, 'item,price\nA,10\nB,20\n', 'utf-8')

      const prepared = await prepareKnowledgeBaseFileForImport({
        filePath,
        appRootPath: join(root, 'app'),
      })

      expect(prepared.filePath).not.toBe(filePath)
      expect(prepared.filePath.endsWith('.md')).toBe(true)
      expect(prepared.originalSourceFilePath).toBe(filePath)
      expect(prepared.wasStructured).toBe(true)
      expect(existsSync(prepared.filePath)).toBe(true)

      const markdown = readFileSync(prepared.filePath, 'utf-8')
      expect(markdown).toContain('# cost.csv')
      expect(markdown).toContain('Original file:')
      expect(markdown).toContain('```csv')
      expect(markdown).toContain('item,price')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
