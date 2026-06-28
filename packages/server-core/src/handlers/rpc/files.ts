import { copyFile, open, readFile, writeFile, unlink, mkdir, readdir, stat } from 'fs/promises'
import { basename, extname, isAbsolute, join, resolve, dirname, parse as parsePath } from 'path'
import { homedir } from 'os'
import { validatePathFormat } from '../../utils/path-validation'
import { randomUUID } from 'crypto'
import {
  RPC_CHANNELS,
  type AttachmentDialogMode,
  type AttachmentDialogResult,
  type FileAttachment,
  type DirectoryListingResult,
  type FilePreviewReadResult,
  type FileWriteTextOptions,
  type FileWriteTextResult,
  type MarkdownExportFormat,
  type MarkdownExportOptions,
  type MarkdownExportResult,
  type SpreadsheetCellValue,
  type SpreadsheetPreviewResult,
} from '@craft-agent/shared/protocol'
import type { StoredAttachment } from '@craft-agent/core/types'
import { getFileType, getMimeType, readFileAttachment, validateImageForClaudeAPI, IMAGE_LIMITS } from '@craft-agent/shared/utils'
import { getSessionAttachmentsPath, getSessionOutputPathFromSessionPath, validateSessionId } from '@craft-agent/shared/sessions'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { resizeImageForAPI, inspectImageBuffer } from '@craft-agent/server-core/services'
import { sanitizeFilename, validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { MarkItDown } from 'markitdown-js'
import xlsx, { type WorkBook, type WorkSheet } from 'xlsx'
import { marked } from 'marked'
import { strToU8, zipSync } from 'fflate'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientOpenFileDialog } from '@craft-agent/server-core/transport'

const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm'])
const MARKDOWN_EDIT_EXTENSIONS = new Set(['.md', '.markdown'])
const OFFICE_PREVIEW_EXTENSIONS = new Set(['.docx', '.doc', '.pptx', '.ppt', '.rtf'])
const TEXT_PREVIEW_MAX_BYTES = 1 * 1024 * 1024
const SPREADSHEET_PREVIEW_MAX_BYTES = 50 * 1024 * 1024
const OFFICE_PREVIEW_CONVERT_MAX_BYTES = 12 * 1024 * 1024
const OFFICE_PREVIEW_TIMEOUT_MS = 20_000
const PATH_BACKED_ATTACHMENT_MAX_BYTES = 250 * 1024 * 1024
const SPREADSHEET_MAX_DECLARED_ROWS = 20_000
const SPREADSHEET_MAX_DECLARED_COLS = 200
const SPREADSHEET_MAX_DECLARED_CELLS = 500_000
const SPREADSHEET_MAX_TOTAL_DECLARED_CELLS = 1_000_000
const SPREADSHEET_SAMPLE_SHEETS = 8
const SPREADSHEET_SAMPLE_ROWS = 12
const SPREADSHEET_SAMPLE_COLS = 8
const SPREADSHEET_TABLE_MAX_ROWS = 200
const SPREADSHEET_TABLE_MAX_COLS = 50
const SPREADSHEET_CELL_TEXT_LIMIT = 160
const ATTACHMENT_DIALOG_MAX_FILES = 250
const ATTACHMENT_DIALOG_MAX_DIRECTORIES = 1_000
const ATTACHMENT_DIALOG_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  'vendor',
  'coverage',
  '.turbo',
  'out',
])

const ATTACHMENT_DIALOG_FILTERS = [
  { name: 'All Files', extensions: ['*'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
  { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
  { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
]

export function buildAttachmentDialogSpec(mode: AttachmentDialogMode = 'files') {
  if (mode === 'folders') {
    return {
      title: 'Attach folder',
      properties: ['openDirectory', 'multiSelections'],
    }
  }

  return {
    title: 'Attach files',
    properties: ['openFile', 'multiSelections'],
    filters: ATTACHMENT_DIALOG_FILTERS,
  }
}

interface SpreadsheetCellRef {
  address: string
  row: number
  col: number
  text: string
}

interface SpreadsheetSheetSummary {
  name: string
  declaredRange: string
  declaredRows: number
  declaredCols: number
  declaredCells: number
  populatedCells: number
  sampleRows: string[][]
}

interface SpreadsheetMarkdownPreviewResult {
  textContent: string
  fullConversionAllowed: boolean
  reason?: string
}

function clampCellText(value: unknown): string {
  const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim()
  if (text.length <= SPREADSHEET_CELL_TEXT_LIMIT) return text
  return `${text.slice(0, SPREADSHEET_CELL_TEXT_LIMIT)}...`
}

function isSpreadsheetPath(filePath: string): boolean {
  return SPREADSHEET_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function isOfficePreviewPath(filePath: string): boolean {
  return OFFICE_PREVIEW_EXTENSIONS.has(extname(filePath).toLowerCase())
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let i = 1; value >= 1024 && i < units.length; i += 1) {
    value /= 1024
    unit = units[i]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readUtf8Prefix(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf-8')
  } finally {
    await handle.close()
  }
}

function truncateTextPreview(content: string, originalSize: number, maxBytes = TEXT_PREVIEW_MAX_BYTES): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, 'utf-8') <= maxBytes) {
    return { content, truncated: false }
  }

  const truncated = Buffer.from(content, 'utf-8').subarray(0, maxBytes).toString('utf-8')
  return {
    content: `${truncated}\n\n---\nPreview truncated at ${formatBytes(maxBytes)} of ${formatBytes(originalSize)}. Open externally for the full file.`,
    truncated: true,
  }
}

function buildMetadataPreview(filePath: string, size: number, reason: string): string {
  return [
    `# File preview: ${basename(filePath)}`,
    '',
    reason,
    '',
    `- Path: ${filePath}`,
    `- Size: ${formatBytes(size)}`,
  ].join('\n')
}

export function getSessionArtifactAllowedDirs(
  sessionManager: Pick<HandlerDeps['sessionManager'], 'getSessions' | 'getSessionPath'>,
  workspaceId?: string | null,
): string[] {
  const dirs = new Set<string>()

  for (const session of sessionManager.getSessions(workspaceId ?? undefined)) {
    const sessionPath = sessionManager.getSessionPath(session.id)
    if (!sessionPath) continue

    dirs.add(sessionPath)
    if (session.workingDirectory) {
      dirs.add(session.workingDirectory)
    }
    dirs.add(getSessionOutputPathFromSessionPath(sessionPath, session.workingDirectory))
  }

  return Array.from(dirs)
}

function getAllowedDirsForFileRequest(deps: HandlerDeps, workspaceId?: string | null): string[] {
  return [
    ...getWorkspaceAllowedDirs(workspaceId),
    ...getSessionArtifactAllowedDirs(deps.sessionManager, workspaceId),
  ]
}

function buildPathBackedAttachment(filePath: string, size: number, name = basename(filePath)): FileAttachment {
  return {
    type: getFileType(filePath),
    path: filePath,
    name,
    mimeType: getMimeType(filePath),
    size,
  }
}

function shouldSkipFolderAttachmentEntry(name: string, isDirectory: boolean): boolean {
  if (name.startsWith('.')) return true
  return isDirectory && ATTACHMENT_DIALOG_SKIP_DIRS.has(name)
}

interface AttachmentDialogCollection {
  attachments: FileAttachment[]
  skippedCount: number
  truncated: boolean
}

export async function collectAttachmentDialogFiles(
  selectedPaths: string[],
  options: { maxFiles?: number; maxDirectories?: number } = {},
): Promise<AttachmentDialogCollection> {
  const maxFiles = options.maxFiles ?? ATTACHMENT_DIALOG_MAX_FILES
  const maxDirectories = options.maxDirectories ?? ATTACHMENT_DIALOG_MAX_DIRECTORIES
  const attachments: FileAttachment[] = []
  const seen = new Set<string>()
  let skippedCount = 0
  let truncated = false
  let visitedDirectories = 0

  const addFile = async (filePath: string, displayName?: string): Promise<void> => {
    if (attachments.length >= maxFiles) {
      truncated = true
      return
    }

    const resolved = resolve(filePath)
    if (seen.has(resolved)) return
    seen.add(resolved)

    const info = await stat(resolved).catch(() => null)
    if (!info || !info.isFile()) {
      skippedCount += 1
      return
    }

    if (info.size === 0 || info.size > PATH_BACKED_ATTACHMENT_MAX_BYTES) {
      skippedCount += 1
      return
    }

    attachments.push(buildPathBackedAttachment(resolved, info.size, displayName))
  }

  for (const selectedPath of selectedPaths) {
    const selectedInfo = await stat(selectedPath).catch(() => null)
    if (!selectedInfo) {
      skippedCount += 1
      continue
    }

    if (selectedInfo.isFile()) {
      await addFile(selectedPath)
      continue
    }

    if (!selectedInfo.isDirectory()) {
      skippedCount += 1
      continue
    }

    const rootPath = resolve(selectedPath)
    const rootName = basename(rootPath)
    const queue: Array<{ dir: string; relDir: string }> = [{ dir: rootPath, relDir: '' }]

    while (queue.length > 0) {
      if (attachments.length >= maxFiles) {
        truncated = true
        break
      }

      if (visitedDirectories >= maxDirectories) {
        truncated = true
        break
      }

      const current = queue.shift()!
      visitedDirectories += 1

      const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => {
        skippedCount += 1
        return []
      })

      for (const entry of entries) {
        if (attachments.length >= maxFiles) {
          truncated = true
          break
        }

        if (entry.isSymbolicLink()) {
          skippedCount += 1
          continue
        }

        const isDirectory = entry.isDirectory()
        if (shouldSkipFolderAttachmentEntry(entry.name, isDirectory)) {
          skippedCount += 1
          continue
        }

        const relativePath = current.relDir ? `${current.relDir}/${entry.name}` : entry.name
        const fullPath = join(current.dir, entry.name)

        if (isDirectory) {
          queue.push({ dir: fullPath, relDir: relativePath })
        } else if (entry.isFile()) {
          await addFile(fullPath, `${rootName}/${relativePath}`)
        } else {
          skippedCount += 1
        }
      }
    }
  }

  return { attachments, skippedCount, truncated }
}

async function prepareImageAttachmentBuffer(
  initialBuffer: Buffer,
  attachment: Pick<FileAttachment, 'mimeType' | 'size'>,
  deps: HandlerDeps,
): Promise<{ buffer: Buffer; wasResized: boolean; resizedBase64?: string }> {
  let decoded = initialBuffer
  let wasResized = false

  const imageInspection = await inspectImageBuffer(decoded, deps.platform.imageProcessor)
  const imageSize = imageInspection.status === 'ok'
    ? { width: imageInspection.width, height: imageInspection.height }
    : null

  let shouldResize = false
  let targetSize: { width: number; height: number } | undefined

  if (imageInspection.status === 'processor_unavailable') {
    deps.platform.logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
    if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
      throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
    }
  } else if (imageInspection.status === 'invalid_image') {
    throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
  } else {
    const validation = validateImageForClaudeAPI(decoded.length, imageSize!.width, imageSize!.height)

    shouldResize = validation.needsResize ?? false
    targetSize = validation.suggestedSize

    if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
      const maxDim = IMAGE_LIMITS.MAX_DIMENSION
      const scale = Math.min(maxDim / imageSize!.width, maxDim / imageSize!.height)
      targetSize = {
        width: Math.floor(imageSize!.width * scale),
        height: Math.floor(imageSize!.height * scale),
      }
      shouldResize = true
      deps.platform.logger.info(`Image exceeds ${maxDim}px limit (${imageSize!.width}x${imageSize!.height}), will resize to ${targetSize.width}x${targetSize.height}`)
    } else if (!validation.valid && validation.errorCode === 'size_exceeded') {
      shouldResize = true
      deps.platform.logger.info(`Image exceeds 5MB (${(decoded.length / 1024 / 1024).toFixed(1)}MB), will attempt resize`)
    } else if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  if (shouldResize) {
    const isPhoto = attachment.mimeType === 'image/jpeg'

    if (targetSize) {
      deps.platform.logger.info(`Resizing image from ${imageSize!.width}x${imageSize!.height} to ${targetSize.width}x${targetSize.height}`)
      try {
        decoded = await deps.platform.imageProcessor.process(decoded, {
          resize: { width: targetSize.width, height: targetSize.height },
          format: isPhoto ? 'jpeg' : 'png',
          quality: isPhoto ? IMAGE_LIMITS.JPEG_QUALITY_HIGH : undefined,
        })
        wasResized = true

        if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
          decoded = await deps.platform.imageProcessor.process(decoded, { format: 'jpeg', quality: IMAGE_LIMITS.JPEG_QUALITY_FALLBACK })
          if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
            throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
          }
        }
      } catch (resizeError) {
        deps.platform.logger.error('Image resize failed:', resizeError)
        const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
        throw new Error(`Image too large (${imageSize!.width}x${imageSize!.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
      }
    } else {
      const result = await resizeImageForAPI(decoded, { isPhoto })
      if (!result) {
        throw new Error(`Image too large (${(decoded.length / 1024 / 1024).toFixed(1)}MB) and could not be compressed enough. Please use a smaller image.`)
      }
      decoded = result.buffer
      wasResized = true
    }

    deps.platform.logger.info(`Image resized: ${attachment.size} -> ${decoded.length} bytes (${Math.round((1 - decoded.length / attachment.size) * 100)}% reduction)`)
  }

  return {
    buffer: decoded,
    wasResized,
    resizedBase64: wasResized ? decoded.toString('base64') : undefined,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function decodeDeclaredRange(ref: string | undefined): { rows: number; cols: number; cells: number } {
  if (!ref) return { rows: 0, cols: 0, cells: 0 }
  try {
    const range = xlsx.utils.decode_range(ref)
    const rows = Math.max(0, range.e.r - range.s.r + 1)
    const cols = Math.max(0, range.e.c - range.s.c + 1)
    return { rows, cols, cells: rows * cols }
  } catch {
    return { rows: 0, cols: 0, cells: 0 }
  }
}

function getSheetCellRefs(worksheet: WorkSheet): SpreadsheetCellRef[] {
  const refs: SpreadsheetCellRef[] = []
  for (const address of Object.keys(worksheet)) {
    if (address.startsWith('!')) continue
    let decoded: { r: number; c: number }
    try {
      decoded = xlsx.utils.decode_cell(address)
    } catch {
      continue
    }
    const cell = worksheet[address] as { v?: unknown; w?: unknown } | undefined
    const text = clampCellText(cell?.w ?? cell?.v)
    if (!text) continue
    refs.push({ address, row: decoded.r, col: decoded.c, text })
  }
  refs.sort((a, b) => (a.row - b.row) || (a.col - b.col))
  return refs
}

function buildSheetSampleRows(cellRefs: SpreadsheetCellRef[]): string[][] {
  const sampleRows: string[][] = []
  const rowIds: number[] = []
  const colIds: number[] = []

  for (const ref of cellRefs) {
    if (!rowIds.includes(ref.row)) {
      if (rowIds.length >= SPREADSHEET_SAMPLE_ROWS) continue
      rowIds.push(ref.row)
    }
    if (!colIds.includes(ref.col)) {
      if (colIds.length >= SPREADSHEET_SAMPLE_COLS) continue
      colIds.push(ref.col)
    }
  }

  rowIds.sort((a, b) => a - b)
  colIds.sort((a, b) => a - b)
  const byPosition = new Map<string, string>()
  for (const ref of cellRefs) {
    if (rowIds.includes(ref.row) && colIds.includes(ref.col)) {
      byPosition.set(`${ref.row}:${ref.col}`, ref.text)
    }
  }

  for (const row of rowIds) {
    sampleRows.push(colIds.map(col => byPosition.get(`${row}:${col}`) ?? ''))
  }
  return sampleRows
}

function markdownTable(headers: string[], rows: string[][]): string {
  const escape = (value: string) => value.replace(/\|/g, '\\|')
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n')
}

export function createSpreadsheetMarkdownPreviewFromWorkbook(workbook: WorkBook, filePath: string, originalName = basename(filePath)): SpreadsheetMarkdownPreviewResult {
  const sheetSummaries: SpreadsheetSheetSummary[] = []
  let totalDeclaredCells = 0
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue
    const declaredRange = worksheet['!ref'] || ''
    const declared = decodeDeclaredRange(declaredRange)
    const cellRefs = getSheetCellRefs(worksheet)
    totalDeclaredCells += declared.cells
    sheetSummaries.push({
      name: sheetName,
      declaredRange,
      declaredRows: declared.rows,
      declaredCols: declared.cols,
      declaredCells: declared.cells,
      populatedCells: cellRefs.length,
      sampleRows: buildSheetSampleRows(cellRefs),
    })
  }

  const oversizedSheets = sheetSummaries.filter(sheet =>
    sheet.declaredRows > SPREADSHEET_MAX_DECLARED_ROWS ||
    sheet.declaredCols > SPREADSHEET_MAX_DECLARED_COLS ||
    sheet.declaredCells > SPREADSHEET_MAX_DECLARED_CELLS
  )
  const fullConversionAllowed = oversizedSheets.length === 0 && totalDeclaredCells <= SPREADSHEET_MAX_TOTAL_DECLARED_CELLS
  const reason = fullConversionAllowed
    ? undefined
    : `Workbook has oversized declared ranges (${oversizedSheets.length} sheet(s), ${totalDeclaredCells.toLocaleString()} declared cells).`

  const summaryRows = sheetSummaries.map(sheet => [
    sheet.name,
    sheet.declaredRange || '(none)',
    sheet.declaredRows.toLocaleString(),
    sheet.declaredCols.toLocaleString(),
    sheet.populatedCells.toLocaleString(),
  ])

  const parts: string[] = [
    `# Spreadsheet attachment preview: ${originalName}`,
    '',
    fullConversionAllowed
      ? 'This is a bounded spreadsheet preview generated during attachment storage. For full analysis, read the original workbook path with spreadsheet-specific tooling.'
      : `Full spreadsheet-to-Markdown conversion was skipped because it is unsafe for foreground attachment storage. ${reason}`,
    '',
    `Original file: ${filePath}`,
    '',
    '## Sheets',
    '',
    markdownTable(['Sheet', 'Declared range', 'Declared rows', 'Declared cols', 'Populated cells'], summaryRows),
  ]

  for (const sheet of sheetSummaries.slice(0, SPREADSHEET_SAMPLE_SHEETS)) {
    if (sheet.sampleRows.length === 0) continue
    const width = Math.max(...sheet.sampleRows.map(row => row.length))
    const headers = Array.from({ length: width }, (_, index) => `Col ${index + 1}`)
    parts.push('', `## Sample: ${sheet.name}`, '', markdownTable(headers, sheet.sampleRows))
  }

  if (sheetSummaries.length > SPREADSHEET_SAMPLE_SHEETS) {
    parts.push('', `[${sheetSummaries.length - SPREADSHEET_SAMPLE_SHEETS} additional sheet(s) omitted from preview.]`)
  }

  return {
    textContent: parts.join('\n'),
    fullConversionAllowed,
    reason,
  }
}

export function createSpreadsheetMarkdownPreview(filePath: string, originalName = basename(filePath)): SpreadsheetMarkdownPreviewResult {
  const workbook = xlsx.readFile(filePath, {
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  })

  return createSpreadsheetMarkdownPreviewFromWorkbook(workbook, filePath, originalName)
}

function spreadsheetColumnLabel(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

function normalizeSpreadsheetCell(value: unknown): SpreadsheetCellValue {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function createSpreadsheetTablePreviewFromWorkbook(
  workbook: WorkBook,
  filePath: string,
  originalName = basename(filePath)
): SpreadsheetPreviewResult {
  const sheets = workbook.SheetNames.slice(0, SPREADSHEET_SAMPLE_SHEETS).map(sheetName => {
    const worksheet = workbook.Sheets[sheetName]
    const matrix = worksheet
      ? xlsx.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, raw: true })
      : []
    const totalRows = matrix.length
    const totalCols = matrix.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
    const visibleCols = Math.min(totalCols, SPREADSHEET_TABLE_MAX_COLS)
    const columns = Array.from({ length: visibleCols }, (_, index) => {
      const label = spreadsheetColumnLabel(index)
      return { key: label, label }
    })
    const rows = matrix.slice(0, SPREADSHEET_TABLE_MAX_ROWS).map(row => {
      const record: Record<string, SpreadsheetCellValue> = {}
      for (let col = 0; col < visibleCols; col += 1) {
        const key = columns[col].key
        record[key] = normalizeSpreadsheetCell(Array.isArray(row) ? row[col] : null)
      }
      return record
    })

    return {
      name: sheetName,
      columns,
      rows,
      totalRows,
      totalCols,
      truncated: totalRows > SPREADSHEET_TABLE_MAX_ROWS || totalCols > SPREADSHEET_TABLE_MAX_COLS,
    }
  })

  return {
    filePath,
    fileName: originalName,
    sheets,
    activeSheet: sheets[0]?.name ?? null,
    truncated: workbook.SheetNames.length > SPREADSHEET_SAMPLE_SHEETS || sheets.some(sheet => sheet.truncated),
  }
}

export function createSpreadsheetTablePreview(filePath: string, originalName = basename(filePath)): SpreadsheetPreviewResult {
  const workbook = xlsx.readFile(filePath, {
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  })

  return createSpreadsheetTablePreviewFromWorkbook(workbook, filePath, originalName)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, '&apos;')
}

function markdownToTextLines(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split('\n')
    .map(line => line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^>\s?/, '')
      .replace(/^\s*[-*+]\s+/, '- ')
      .replace(/^\s*\d+\.\s+/, match => match.trim() + ' ')
      .replace(/[*_`~]/g, '')
      .trimEnd()
    )
}

async function createMarkdownHtml(content: string, title: string): Promise<string> {
  const body = await Promise.resolve(marked.parse(content, { gfm: true, breaks: false }))
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.65;max-width:900px;margin:40px auto;padding:0 32px;color:#202124;}',
    'h1,h2,h3{line-height:1.25;margin-top:1.6em;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #d0d7de;padding:6px 8px;} code,pre{background:#f6f8fa;border-radius:4px;} pre{padding:12px;overflow:auto;}',
    '</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n')
}

function createDocxBuffer(markdown: string): Buffer {
  const paragraphs = markdownToTextLines(markdown).map(line =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  ).join('')

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8([
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>',
    ].join('')),
    '_rels/.rels': strToU8([
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>',
    ].join('')),
    'word/document.xml': strToU8([
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      paragraphs || '<w:p/>',
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>',
    ].join('')),
  }

  return Buffer.from(zipSync(files))
}

function utf16BeHex(value: string): string {
  const buffer = Buffer.alloc(value.length * 2)
  for (let index = 0; index < value.length; index += 1) {
    buffer.writeUInt16BE(value.charCodeAt(index), index * 2)
  }
  return buffer.toString('hex').toUpperCase()
}

function textWidthUnits(value: string): number {
  let width = 0
  for (const char of value) {
    width += char.charCodeAt(0) > 255 ? 2 : 1
  }
  return width
}

function wrapPdfLine(line: string, maxUnits = 78): string[] {
  if (!line) return ['']
  const wrapped: string[] = []
  let current = ''
  let units = 0
  for (const char of line) {
    const charUnits = char.charCodeAt(0) > 255 ? 2 : 1
    if (units + charUnits > maxUnits && current) {
      wrapped.push(current)
      current = ''
      units = 0
    }
    current += char
    units += charUnits
  }
  if (current) wrapped.push(current)
  return wrapped
}

function createPdfBuffer(markdown: string): Buffer {
  const lines = markdownToTextLines(markdown).flatMap(line => wrapPdfLine(line))
  const linesPerPage = 48
  const pages = Math.max(1, Math.ceil(lines.length / linesPerPage))
  const objects: Array<{ id: number; body: string }> = [
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, index) => `${6 + index * 2} 0 R`).join(' ')}] /Count ${pages} >>` },
    { id: 3, body: '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>' },
    { id: 4, body: '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /FontDescriptor 5 0 R /DW 1000 >>' },
    { id: 5, body: '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>' },
  ]

  for (let page = 0; page < pages; page += 1) {
    const pageLines = lines.slice(page * linesPerPage, (page + 1) * linesPerPage)
    const commands = [
      'BT',
      '/F1 11 Tf',
      '15 TL',
      '50 790 Td',
      ...pageLines.flatMap((line, index) => {
        const move = index === 0 ? [] : ['T*']
        return line ? [...move, `<${utf16BeHex(line)}> Tj`] : [...move]
      }),
      'ET',
    ].join('\n')
    const contentId = 7 + page * 2
    const pageId = 6 + page * 2
    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    })
    objects.push({
      id: contentId,
      body: `<< /Length ${Buffer.byteLength(commands, 'utf-8')} >>\nstream\n${commands}\nendstream`,
    })
  }

  objects.sort((a, b) => a.id - b.id)
  const chunks: string[] = ['%PDF-1.4\n% Agent Pi\n']
  const offsets: number[] = [0]
  for (const object of objects) {
    offsets[object.id] = Buffer.byteLength(chunks.join(''), 'utf-8')
    chunks.push(`${object.id} 0 obj\n${object.body}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf-8')
  const maxId = Math.max(...objects.map(object => object.id))
  chunks.push(`xref\n0 ${maxId + 1}\n`)
  chunks.push('0000000000 65535 f \n')
  for (let id = 1; id <= maxId; id += 1) {
    chunks.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return Buffer.from(chunks.join(''), 'utf-8')
}

async function getAvailableExportPath(sourcePath: string, format: MarkdownExportFormat, targetPath?: string): Promise<string> {
  if (targetPath) return targetPath
  const parsed = parsePath(sourcePath)
  const baseName = sanitizeFilename(parsed.name || 'document')
  const ext = format === 'html' ? '.html' : `.${format}`
  let candidate = join(parsed.dir, `${baseName}${ext}`)
  let counter = 2
  while (await pathExists(candidate)) {
    candidate = join(parsed.dir, `${baseName} ${counter}${ext}`)
    counter += 1
  }
  return candidate
}

export async function buildMarkdownExport(args: {
  sourcePath: string
  content: string
  format: MarkdownExportFormat
  targetPath?: string
}): Promise<MarkdownExportResult> {
  const targetPath = await getAvailableExportPath(args.sourcePath, args.format, args.targetPath)
  const title = basename(args.sourcePath)
  let output: string | Buffer

  if (args.format === 'html') {
    output = await createMarkdownHtml(args.content, title)
  } else if (args.format === 'docx') {
    output = createDocxBuffer(args.content)
  } else {
    output = createPdfBuffer(args.content)
  }

  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, output)
  const info = await stat(targetPath)
  return { path: targetPath, format: args.format, bytes: info.size }
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.file.READ,
  RPC_CHANNELS.file.READ_PREVIEW,
  RPC_CHANNELS.file.READ_SPREADSHEET_PREVIEW,
  RPC_CHANNELS.file.WRITE_TEXT,
  RPC_CHANNELS.file.EXPORT_MARKDOWN,
  RPC_CHANNELS.file.READ_DATA_URL,
  RPC_CHANNELS.file.READ_PREVIEW_DATA_URL,
  RPC_CHANNELS.file.READ_BINARY,
  RPC_CHANNELS.file.OPEN_DIALOG,
  RPC_CHANNELS.file.OPEN_ATTACHMENT_DIALOG,
  RPC_CHANNELS.file.READ_ATTACHMENT,
  RPC_CHANNELS.file.READ_USER_ATTACHMENT,
  RPC_CHANNELS.file.STORE_ATTACHMENT,
  RPC_CHANNELS.file.GENERATE_THUMBNAIL,
  RPC_CHANNELS.fs.SEARCH,
  RPC_CHANNELS.fs.LIST_DIRECTORY,
] as const

export function registerFilesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Read a file (with path validation to prevent traversal attacks)
  server.handle(RPC_CHANNELS.file.READ, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const content = await readFile(safePath, 'utf-8')
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // ENOENT is expected for optional config files (e.g. automations.json)
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        deps.platform.logger.debug('readFile: file not found:', path)
      } else {
        deps.platform.logger.error('readFile error:', path, message)
      }
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Read a size-bounded preview for in-app file overlays. This avoids loading
  // huge text/Office files into renderer memory just because a user clicked a link.
  server.handle(RPC_CHANNELS.file.READ_PREVIEW, async (ctx, path: string): Promise<FilePreviewReadResult> => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const info = await stat(safePath)
      if (!info.isFile()) {
        throw new Error('Path is not a file')
      }

      if (isSpreadsheetPath(safePath)) {
        if (info.size > SPREADSHEET_PREVIEW_MAX_BYTES) {
          return {
            content: buildMetadataPreview(
              safePath,
              info.size,
              `Spreadsheet is too large for foreground preview (${formatBytes(info.size)} > ${formatBytes(SPREADSHEET_PREVIEW_MAX_BYTES)}).`
            ),
            truncated: true,
            originalSize: info.size,
            mtimeMs: info.mtimeMs,
            previewKind: 'spreadsheet',
          }
        }

        const preview = createSpreadsheetMarkdownPreview(safePath, basename(safePath))
        return {
          content: preview.textContent,
          truncated: !preview.fullConversionAllowed,
          originalSize: info.size,
          mtimeMs: info.mtimeMs,
          previewKind: 'spreadsheet',
        }
      }

      if (isOfficePreviewPath(safePath)) {
        if (info.size > OFFICE_PREVIEW_CONVERT_MAX_BYTES) {
          return {
            content: buildMetadataPreview(
              safePath,
              info.size,
              `Office document is too large for safe foreground conversion (${formatBytes(info.size)} > ${formatBytes(OFFICE_PREVIEW_CONVERT_MAX_BYTES)}).`
            ),
            truncated: true,
            originalSize: info.size,
            mtimeMs: info.mtimeMs,
            previewKind: 'office',
          }
        }

        const markitdown = new MarkItDown()
        const result = await withTimeout(markitdown.convert(safePath), OFFICE_PREVIEW_TIMEOUT_MS, 'Office preview conversion')
        const textContent = result?.textContent?.trim()
        if (!textContent) {
          return {
            content: buildMetadataPreview(safePath, info.size, 'Office conversion returned no readable text.'),
            truncated: true,
            originalSize: info.size,
            mtimeMs: info.mtimeMs,
            previewKind: 'office',
          }
        }

        const preview = truncateTextPreview(textContent, info.size)
        return {
          content: preview.content,
          truncated: preview.truncated,
          originalSize: info.size,
          mtimeMs: info.mtimeMs,
          previewKind: 'office',
        }
      }

      if (info.size > TEXT_PREVIEW_MAX_BYTES) {
        const content = await readUtf8Prefix(safePath, TEXT_PREVIEW_MAX_BYTES)
        return {
          content: `${content}\n\n---\nPreview truncated at ${formatBytes(TEXT_PREVIEW_MAX_BYTES)} of ${formatBytes(info.size)}. Open externally for the full file.`,
          truncated: true,
          originalSize: info.size,
          mtimeMs: info.mtimeMs,
          previewKind: 'text',
        }
      }

      return {
        content: await readFile(safePath, 'utf-8'),
        truncated: false,
        originalSize: info.size,
        mtimeMs: info.mtimeMs,
        previewKind: 'text',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFilePreview error:', path, message)
      throw new Error(`Failed to read file preview: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.file.READ_SPREADSHEET_PREVIEW, async (ctx, path: string): Promise<SpreadsheetPreviewResult> => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const info = await stat(safePath)
      if (!info.isFile()) {
        throw new Error('Path is not a file')
      }
      if (!isSpreadsheetPath(safePath)) {
        throw new Error('Path is not a supported spreadsheet')
      }
      if (info.size > SPREADSHEET_PREVIEW_MAX_BYTES) {
        return {
          filePath: safePath,
          fileName: basename(safePath),
          sheets: [],
          activeSheet: null,
          truncated: true,
          originalSize: info.size,
          mtimeMs: info.mtimeMs,
        }
      }

      const preview = createSpreadsheetTablePreview(safePath, basename(safePath))
      return {
        ...preview,
        originalSize: info.size,
        mtimeMs: info.mtimeMs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readSpreadsheetPreview error:', path, message)
      throw new Error(`Failed to read spreadsheet preview: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.file.WRITE_TEXT, async (ctx, path: string, content: string, options?: FileWriteTextOptions): Promise<FileWriteTextResult> => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const ext = extname(safePath).toLowerCase()
      if (!MARKDOWN_EDIT_EXTENSIONS.has(ext)) {
        throw new Error('Only Markdown files can be edited in preview')
      }
      const info = await stat(safePath)
      if (!info.isFile()) {
        throw new Error('Path is not a file')
      }
      if (typeof options?.expectedMtimeMs === 'number' && Math.abs(info.mtimeMs - options.expectedMtimeMs) > 5) {
        throw new Error('File changed on disk after preview was opened. Reopen the file before saving.')
      }

      await writeFile(safePath, content, 'utf-8')
      const updated = await stat(safePath)
      return {
        path: safePath,
        bytes: Buffer.byteLength(content, 'utf-8'),
        mtimeMs: updated.mtimeMs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('writeText error:', path, message)
      throw new Error(`Failed to save file: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.file.EXPORT_MARKDOWN, async (ctx, path: string, options: MarkdownExportOptions): Promise<MarkdownExportResult> => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const allowedDirs = getAllowedDirsForFileRequest(deps, workspaceId)
      const safePath = await validateFilePath(path, allowedDirs)
      const ext = extname(safePath).toLowerCase()
      if (!MARKDOWN_EDIT_EXTENSIONS.has(ext)) {
        throw new Error('Only Markdown files can be exported from preview')
      }
      if (!['html', 'docx', 'pdf'].includes(options.format)) {
        throw new Error(`Unsupported Markdown export format: ${options.format}`)
      }
      const info = await stat(safePath)
      if (!info.isFile()) {
        throw new Error('Path is not a file')
      }

      const targetPath = options.targetPath
        ? await validateFilePath(options.targetPath, allowedDirs)
        : undefined
      const content = options.content ?? await readFile(safePath, 'utf-8')
      return await buildMarkdownExport({
        sourcePath: safePath,
        content,
        format: options.format,
        targetPath,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('exportMarkdown error:', path, message)
      throw new Error(`Failed to export Markdown: ${message}`)
    }
  })

  // Read an image file as a data URL for in-app image preview overlays.
  // Returns data:{mime};base64,{content} — used by ImagePreviewOverlay and markdown image blocks.
  server.handle(RPC_CHANNELS.file.READ_DATA_URL, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const buffer = await readFile(safePath)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? ''

      // Map previewable image extensions to MIME types.
      // HEIC/HEIF/TIFF are intentionally excluded — no Chromium codec, opened externally instead.
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        avif: 'image/avif',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileDataUrl error:', message)
      throw new Error(`Failed to read file as data URL: ${message}`)
    }
  })

  // Read an image file as a small preview data URL for lightweight thumbnail rendering.
  // Returns a PNG data URL resized to fit within maxSize×maxSize.
  server.handle(RPC_CHANNELS.file.READ_PREVIEW_DATA_URL, async (ctx, path: string, maxSize = 64) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const size = Number.isFinite(maxSize) ? Math.max(16, Math.min(256, Math.floor(maxSize))) : 64
      const preview = await deps.platform.imageProcessor.process(safePath, {
        resize: { width: size, height: size },
        fit: 'inside',
        format: 'png',
      })
      return `data:image/png;base64,${preview.toString('base64')}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFilePreviewDataUrl error:', message)
      throw new Error(`Failed to read file preview: ${message}`)
    }
  })

  // Read a file as raw binary (Uint8Array) for react-pdf.
  // The WS transport codec preserves Uint8Array payloads over JSON envelopes.
  server.handle(RPC_CHANNELS.file.READ_BINARY, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      const buffer = await readFile(safePath)
      // Return as Uint8Array (serializes to ArrayBuffer over IPC)
      return new Uint8Array(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileBinary error:', message)
      throw new Error(`Failed to read file as binary: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach (routed to client)
  server.handle(RPC_CHANNELS.file.OPEN_DIALOG, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        // Allow all files by default - the agent can figure out how to handle them
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Open native attachment dialog for selecting files or folders. Windows native
  // dialogs cannot reliably show files when openDirectory is mixed with openFile,
  // so the renderer chooses an explicit mode before opening the picker.
  // expanded into ordinary path-backed file attachments with hard caps so a
  // mis-click on a project root cannot flood the composer.
  server.handle(RPC_CHANNELS.file.OPEN_ATTACHMENT_DIALOG, async (ctx, mode?: AttachmentDialogMode): Promise<AttachmentDialogResult> => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, buildAttachmentDialogSpec(mode))

    if (result.canceled) {
      return {
        attachments: [],
        skippedCount: 0,
        truncated: false,
        maxFiles: ATTACHMENT_DIALOG_MAX_FILES,
      }
    }

    const collected = await collectAttachmentDialogFiles(result.filePaths)

    for (const attachment of collected.attachments) {
      if (attachment.type !== 'image') continue
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(attachment.path, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        attachment.thumbnailBase64 = thumbBuffer.toString('base64')
      } catch {
        // Image thumbnail is optional; attachment storage validates the image later.
      }
    }

    return {
      attachments: collected.attachments,
      skippedCount: collected.skippedCount,
      truncated: collected.truncated,
      maxFiles: ATTACHMENT_DIALOG_MAX_FILES,
    }
  })

  // Read file and return as FileAttachment with Quick Look thumbnail
  server.handle(RPC_CHANNELS.file.READ_ATTACHMENT, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getAllowedDirsForFileRequest(deps, workspaceId))
      // Use shared utility that handles file type detection, encoding, etc.
      const attachment = await readFileAttachment(safePath)
      if (!attachment) return null

      // Generate thumbnail for image preview
      // Only works for image formats the processor supports — PDFs/Office files get icon fallback
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(safePath, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch (thumbError) {
        // Thumbnail generation failed (non-image file or corrupt) — icon fallback
        deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileAttachment error:', message)
      return null
    }
  })

  // Read a user-attached file (bypasses workspace-dir validation).
  // Used only by renderer draft hydration: the path was written to drafts.json by a
  // previous user-initiated OS-picker / Finder-drag attach, so the path implies consent.
  // NOT exposed to agent code — no equivalent MCP tool. Kept separate from readFileAttachment
  // on purpose to preserve the agent-facing read's narrow trust boundary.
  server.handle(RPC_CHANNELS.file.READ_USER_ATTACHMENT, async (_ctx, path: string) => {
    try {
      if (!path || typeof path !== 'string' || !isAbsolute(path)) return null
      const formatCheck = validatePathFormat(path)
      if (!formatCheck.valid) return null
      const info = await stat(path).catch(() => null)
      if (!info || !info.isFile()) return null
      if (info.size > PATH_BACKED_ATTACHMENT_MAX_BYTES) {
        deps.platform.logger.warn(`[readUserAttachment] file exceeds ${PATH_BACKED_ATTACHMENT_MAX_BYTES} bytes, skipping: ${path}`)
        return null
      }
      const attachment = buildPathBackedAttachment(path, info.size)
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(path, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch {
        // Non-image or corrupt — icon fallback, same as readFileAttachment
      }
      return attachment
    } catch (error) {
      deps.platform.logger.error('readUserAttachment error:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Generate thumbnail from base64 data (for drag-drop files where we don't have a path)
  server.handle(RPC_CHANNELS.file.GENERATE_THUMBNAIL, async (_ctx, base64: string, _mimeType: string): Promise<string | null> => {
    try {
      const buffer = Buffer.from(base64, 'base64')
      const thumbBuffer = await deps.platform.imageProcessor.process(buffer, {
        resize: { width: 200, height: 200 },
        format: 'png',
      })
      return thumbBuffer.toString('base64')
    } catch (error) {
      deps.platform.logger.info('generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown preview data.
  // This is the core of the persistent file attachment system
  server.handle(RPC_CHANNELS.file.STORE_ATTACHMENT, async (ctx, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Get workspace slug from the calling window
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      if (!workspaceId) {
        throw new Error('Cannot determine workspace for attachment storage')
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      const workspaceRootPath = workspace.rootPath

      // SECURITY: Validate sessionId to prevent path traversal attacks
      // This must happen before using sessionId in any file path operations
      validateSessionId(sessionId)

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // Track if image was resized (for return value)
      let wasResized = false
      let finalSize = attachment.size
      let resizedBase64: string | undefined

      // 1. Save the file (with image validation and resizing)
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        let decoded: Buffer = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
        }

        if (attachment.type === 'image') {
          const prepared = await prepareImageAttachmentBuffer(decoded, attachment, deps)
          decoded = prepared.buffer
          wasResized = prepared.wasResized
          finalSize = decoded.length
          resizedBase64 = prepared.resizedBase64
        }

        await writeFile(storedPath, decoded)
        filesToCleanup.push(storedPath)
      } else if (attachment.text) {
        // Text files - save as UTF-8
        await writeFile(storedPath, attachment.text, 'utf-8')
        filesToCleanup.push(storedPath)
      } else if (attachment.path && isAbsolute(attachment.path)) {
        const formatCheck = validatePathFormat(attachment.path)
        if (!formatCheck.valid) {
          throw new Error(formatCheck.reason ?? 'Invalid attachment path')
        }
        const sourceInfo = await stat(attachment.path).catch(() => null)
        if (!sourceInfo || !sourceInfo.isFile()) {
          throw new Error(`Attachment source file not found: ${attachment.path}`)
        }
        if (sourceInfo.size > PATH_BACKED_ATTACHMENT_MAX_BYTES) {
          throw new Error(`Attachment too large (${formatBytes(sourceInfo.size)} > ${formatBytes(PATH_BACKED_ATTACHMENT_MAX_BYTES)})`)
        }
        finalSize = sourceInfo.size
        if (attachment.type === 'image') {
          const prepared = await prepareImageAttachmentBuffer(await readFile(attachment.path), attachment, deps)
          await writeFile(storedPath, prepared.buffer)
          wasResized = prepared.wasResized
          finalSize = prepared.buffer.length
          resizedBase64 = prepared.resizedBase64
        } else {
          await copyFile(attachment.path, storedPath)
        }
        filesToCleanup.push(storedPath)
      } else {
        throw new Error('Attachment has no content or readable source path')
      }

      // 2. Generate thumbnail for images only. Do not ask the image pipeline to
      // inspect Office/PDF binaries on the foreground attachment RPC path.
      let thumbnailPath: string | undefined
      let thumbnailBase64: string | undefined
      if (attachment.type === 'image') {
        const thumbFileName = `${id}_thumb.png`
        const thumbPath = join(attachmentsDir, thumbFileName)
        try {
          const pngBuffer = await deps.platform.imageProcessor.process(storedPath, {
            resize: { width: 200, height: 200 },
            format: 'png',
          })
          await writeFile(thumbPath, pngBuffer)
          thumbnailPath = thumbPath
          thumbnailBase64 = pngBuffer.toString('base64')
          filesToCleanup.push(thumbPath)
        } catch (thumbError) {
          // Thumbnail generation failed (corrupt/unsupported image) — icon fallback
          deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
        }
      }

      // 3. Convert Office files to markdown/preview metadata. Attachment storage
      // must remain reliable even if conversion fails: the original file path is
      // enough for the agent to inspect with dedicated tools later.
      let markdownPath: string | undefined
      if (attachment.type === 'office') {
        const mdFileName = `${id}_${safeName}.md`
        const mdPath = join(attachmentsDir, mdFileName)
        try {
          let textContent: string | undefined
          const storedInfo = await stat(storedPath)
          if (isSpreadsheetPath(storedPath) && storedInfo.size > SPREADSHEET_PREVIEW_MAX_BYTES) {
            textContent = buildMetadataPreview(
              storedPath,
              storedInfo.size,
              `Spreadsheet is too large for safe foreground conversion (${formatBytes(storedInfo.size)} > ${formatBytes(SPREADSHEET_PREVIEW_MAX_BYTES)}).`
            )
          } else if (isSpreadsheetPath(storedPath)) {
            const preview = createSpreadsheetMarkdownPreview(storedPath, attachment.name)
            textContent = preview.textContent
            if (!preview.fullConversionAllowed) {
              deps.platform.logger.warn(`Spreadsheet full conversion skipped for "${attachment.name}": ${preview.reason}`)
            }
          } else if (storedInfo.size > OFFICE_PREVIEW_CONVERT_MAX_BYTES) {
            textContent = buildMetadataPreview(
              storedPath,
              storedInfo.size,
              `Office document is too large for safe foreground conversion (${formatBytes(storedInfo.size)} > ${formatBytes(OFFICE_PREVIEW_CONVERT_MAX_BYTES)}).`
            )
          } else {
            const markitdown = new MarkItDown()
            const result = await withTimeout(markitdown.convert(storedPath), OFFICE_PREVIEW_TIMEOUT_MS, 'Office attachment conversion')
            textContent = result?.textContent
          }
          if (!textContent) {
            throw new Error('Conversion returned empty result')
          }
          await writeFile(mdPath, textContent, 'utf-8')
          markdownPath = mdPath
          filesToCleanup.push(mdPath)
          deps.platform.logger.info(`Created Office markdown preview: ${mdPath}`)
        } catch (convertError) {
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          deps.platform.logger.warn(`Office markdown preview failed for "${attachment.name}", keeping stored original only: ${errorMsg}`)
        }
      }

      // Return StoredAttachment metadata
      // Include wasResized flag so UI can show notification
      // Include resizedBase64 so renderer uses resized image for Claude API
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: finalSize, // Use final size (may differ if resized)
        originalSize: wasResized ? attachment.size : undefined, // Track original if resized
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
        wasResized,
        resizedBase64, // Only set when wasResized=true, used for Claude API
      }
    } catch (error) {
      // Clean up any files we've written before the error
      if (filesToCleanup.length > 0) {
        deps.platform.logger.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Filesystem search for @ mention file selection.
  // Parallel BFS walk that skips ignored directories BEFORE entering them,
  // avoiding reading node_modules/etc. contents entirely. Uses withFileTypes
  // to get entry types without separate stat calls.
  server.handle(RPC_CHANNELS.fs.SEARCH, async (_ctx, basePath: string, query: string) => {
    deps.platform.logger.info('[FS_SEARCH] called:', basePath, query)
    const MAX_RESULTS = 50

    // Directories to never recurse into
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
      '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
      '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
    ])

    const lowerQuery = query.toLowerCase()
    const results: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }> = []

    try {
      // BFS queue: each entry is a relative path prefix ('' for root)
      let queue = ['']

      while (queue.length > 0 && results.length < MAX_RESULTS) {
        // Process current level: read all directories in parallel
        const nextQueue: string[] = []

        const dirResults = await Promise.all(
          queue.map(async (relDir) => {
            const absDir = relDir ? join(basePath, relDir) : basePath
            try {
              return { relDir, entries: await readdir(absDir, { withFileTypes: true }) }
            } catch {
              // Skip dirs we can't read (permissions, broken symlinks, etc.)
              return { relDir, entries: [] as import('fs').Dirent[] }
            }
          })
        )

        for (const { relDir, entries } of dirResults) {
          if (results.length >= MAX_RESULTS) break

          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break

            const name = entry.name
            // Skip hidden files/dirs and ignored directories
            if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

            const relativePath = relDir ? `${relDir}/${name}` : name
            const isDir = entry.isDirectory()

            // Queue subdirectories for next BFS level
            if (isDir) {
              nextQueue.push(relativePath)
            }

            // Check if name or path matches the query
            const lowerName = name.toLowerCase()
            const lowerRelative = relativePath.toLowerCase()
            if (lowerName.includes(lowerQuery) || lowerRelative.includes(lowerQuery)) {
              results.push({
                name,
                path: join(basePath, relativePath),
                type: isDir ? 'directory' : 'file',
                relativePath,
              })
            }
          }
        }

        queue = nextQueue
      }

      // Sort: directories first, then by name length (shorter = better match)
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.length - b.name.length
      })

      deps.platform.logger.info('[FS_SEARCH] returning', results.length, 'results')
      return results
    } catch (err) {
      deps.platform.logger.error('[FS_SEARCH] error:', err)
      return []
    }
  })

  // List directories in a given path (for remote directory browsing).
  // Returns only directories (not files) — this is a folder picker.
  server.handle(RPC_CHANNELS.fs.LIST_DIRECTORY, async (_ctx, dirPath: string) => {
    // Resolve ~ to server's home directory (thin clients don't know the server's home)
    if (dirPath === '~' || dirPath.startsWith('~/')) {
      dirPath = dirPath === '~' ? homedir() : join(homedir(), dirPath.slice(2))
    }

    // Reject cross-platform and relative paths before resolve() can concatenate with cwd
    const pathCheck = validatePathFormat(dirPath)
    if (!pathCheck.valid) {
      throw new Error(pathCheck.reason!)
    }

    // Normalize (collapses .. segments, trailing slashes, etc.)
    const resolved = resolve(dirPath)

    // Read entries, filter to directories
    const raw = await readdir(resolved, { withFileTypes: true })

    const entries: Array<{ name: string; path: string; isSymlink: boolean }> = []
    for (const entry of raw) {
      const fullPath = join(resolved, entry.name)
      const isSymlink = entry.isSymbolicLink()

      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: fullPath, isSymlink: false })
      } else if (isSymlink) {
        // Follow symlink — check if target is a directory
        try {
          const target = await stat(fullPath)
          if (target.isDirectory()) {
            entries.push({ name: entry.name, path: fullPath, isSymlink: true })
          }
        } catch {
          // Broken symlink — skip silently
        }
      }
    }

    // Sort alphabetically (case-insensitive), cap at 500
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const totalEntries = entries.length
    const truncated = totalEntries > 500
    if (truncated) entries.length = 500

    // Compute parent path
    const parentPath = resolved === parsePath(resolved).root ? null : dirname(resolved)

    // Compute breadcrumbs server-side
    const breadcrumbs: Array<{ name: string; path: string }> = []
    let current = resolved
    while (true) {
      const parsed = parsePath(current)
      const name = parsed.base || parsed.root
      breadcrumbs.unshift({ name, path: current })
      if (current === parsed.root) break
      current = dirname(current)
    }

    return {
      currentPath: resolved,
      parentPath,
      breadcrumbs,
      platform: process.platform as DirectoryListingResult['platform'],
      truncated,
      totalEntries,
      entries,
    } satisfies DirectoryListingResult
  })
}
