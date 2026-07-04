import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { MarkItDown } from 'markitdown-js'

const DIRECT_KNOWLEDGE_BASE_EXTENSIONS = new Set(['.md', '.txt', '.json'])
const CSV_EXTENSIONS = new Set(['.csv', '.tsv'])

export interface PrepareKnowledgeBaseFileForImportInput {
  filePath: string
  appRootPath: string
}

export interface PreparedKnowledgeBaseFile {
  filePath: string
  originalSourceFilePath: string
  wasStructured: boolean
}

export async function prepareKnowledgeBaseFileForImport(
  input: PrepareKnowledgeBaseFileForImportInput
): Promise<PreparedKnowledgeBaseFile> {
  const sourcePath = resolve(input.filePath)
  if (!existsSync(sourcePath)) {
    throw new Error(`File not found: ${sourcePath}`)
  }

  const extension = extname(sourcePath).toLowerCase()
  if (DIRECT_KNOWLEDGE_BASE_EXTENSIONS.has(extension)) {
    return {
      filePath: sourcePath,
      originalSourceFilePath: sourcePath,
      wasStructured: false,
    }
  }

  const markdownPath = getStructuredImportPath(input.appRootPath, sourcePath)
  const markdown = CSV_EXTENSIONS.has(extension)
    ? buildDelimitedMarkdown(sourcePath, extension === '.tsv' ? 'tsv' : 'csv')
    : await buildConvertedMarkdown(sourcePath)

  mkdirSync(dirname(markdownPath), { recursive: true })
  writeFileSync(markdownPath, markdown, 'utf-8')
  return {
    filePath: markdownPath,
    originalSourceFilePath: sourcePath,
    wasStructured: true,
  }
}

function getStructuredImportPath(appRootPath: string, sourcePath: string): string {
  const hash = createHash('sha1').update(sourcePath).digest('hex').slice(0, 10)
  const name = sanitizeFileName(`${basename(sourcePath)}.structured.md`)
  return join(appRootPath, 'knowledge-base', 'imports', hash, name)
}

function buildDelimitedMarkdown(sourcePath: string, language: 'csv' | 'tsv'): string {
  const content = readFileSync(sourcePath, 'utf-8').trim()
  if (!content) {
    throw new Error(`No text content was found in ${sourcePath}`)
  }
  return [
    `# ${basename(sourcePath)}`,
    '',
    `Original file: ${sourcePath}`,
    '',
    `Structured import format: ${language.toUpperCase()}`,
    '',
    `\`\`\`${language}`,
    content,
    '```',
    '',
  ].join('\n')
}

async function buildConvertedMarkdown(sourcePath: string): Promise<string> {
  const markitdown = new MarkItDown()
  const result = await markitdown.convert(sourcePath)
  const textContent = result?.textContent?.trim()
  if (!textContent) {
    throw new Error(`Document conversion returned no readable text for ${sourcePath}`)
  }
  return [
    `# ${basename(sourcePath)}`,
    '',
    `Original file: ${sourcePath}`,
    '',
    'Structured import format: Markdown conversion',
    '',
    textContent,
    '',
  ].join('\n')
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180) || 'knowledge-source.structured.md'
}
