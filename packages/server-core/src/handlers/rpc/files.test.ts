import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { buildAttachmentDialogSpec, canExportMarkdownPreviewSource, collectAttachmentDialogFiles } from './files'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const parent = join(process.cwd(), '.codex-temp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'attachment-dialog-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('collectAttachmentDialogFiles', () => {
  test('accepts large path-backed PDFs without loading them into memory', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'large-tender-volume.pdf')
    const handle = await open(selected, 'w')
    await handle.truncate(300 * 1024 * 1024)
    await handle.close()

    const result = await collectAttachmentDialogFiles([selected])

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toMatchObject({
      type: 'pdf',
      path: selected,
      name: 'large-tender-volume.pdf',
      size: 300 * 1024 * 1024,
    })
    expect(result.attachments[0]?.base64).toBeUndefined()
    expect(result.skippedCount).toBe(0)
  })

  test('keeps selected folders as path-only references instead of uploading their files', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'Project Docs')
    await mkdir(join(selected, 'nested'), { recursive: true })
    await mkdir(join(selected, 'node_modules'), { recursive: true })
    await mkdir(join(selected, '.git'), { recursive: true })
    await writeFile(join(selected, 'brief.md'), 'brief')
    await writeFile(join(selected, 'nested', 'scope.txt'), 'scope')
    await writeFile(join(selected, 'node_modules', 'skip.js'), 'skip')
    await writeFile(join(selected, '.hidden.txt'), 'secret')
    await writeFile(join(selected, '.git', 'config'), 'skip')

    const result = await collectAttachmentDialogFiles([selected])

    const expectedText = [
      `Folder path: ${selected}`,
      '',
      'The folder contents were not uploaded. Use filesystem tools to scan and analyze this local directory when needed.',
    ].join('\n')
    expect(result.attachments).toEqual([{
      type: 'text',
      path: selected,
      name: basename(selected),
      mimeType: 'text/plain',
      size: Buffer.byteLength(expectedText, 'utf-8'),
      text: expectedText,
    }])
    expect(result.skippedCount).toBe(0)
    expect(result.truncated).toBe(false)
  })

  test('keeps explicitly selected hidden files while selected folders remain path-only references', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'docs')
    const explicitHidden = join(selected, '.env')
    await mkdir(selected, { recursive: true })
    await writeFile(explicitHidden, 'API_KEY=example')
    await writeFile(join(selected, 'visible.txt'), 'visible')

    const result = await collectAttachmentDialogFiles([selected, explicitHidden])

    expect(result.attachments.map(a => a.name)).toEqual(['docs', '.env'])
    expect(result.attachments[0]?.path).toBe(selected)
    expect(result.attachments[0]?.text).toContain(`Folder path: ${selected}`)
  })

  test('does not traverse selected folders when applying the file cap', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'many')
    await mkdir(selected, { recursive: true })
    await writeFile(join(selected, 'a.txt'), 'a')
    await writeFile(join(selected, 'b.txt'), 'b')
    await writeFile(join(selected, 'c.txt'), 'c')

    const result = await collectAttachmentDialogFiles([selected], { maxFiles: 2 })

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]?.path).toBe(selected)
    expect(result.truncated).toBe(false)
  })
})

describe('buildAttachmentDialogSpec', () => {
  test('defaults to file selection so Windows shows files in the picker', () => {
    const spec = buildAttachmentDialogSpec()

    expect(spec.title).toBe('Attach files')
    expect(spec.properties).toContain('openFile')
    expect(spec.properties).toContain('multiSelections')
    expect(spec.properties).not.toContain('openDirectory')
    expect(spec.filters).toEqual([{ name: 'All Files', extensions: ['*'] }])
  })

  test('uses directory-only mode when attaching a folder', () => {
    const spec = buildAttachmentDialogSpec('folders')

    expect(spec.title).toBe('Attach folder')
    expect(spec.properties).toContain('openDirectory')
    expect(spec.properties).not.toContain('openFile')
  })
})

describe('canExportMarkdownPreviewSource', () => {
  test('allows real Markdown sources without provided content', () => {
    expect(canExportMarkdownPreviewSource(join('docs', 'report.md'), false)).toBe(true)
    expect(canExportMarkdownPreviewSource(join('docs', 'report.markdown'), false)).toBe(true)
  })

  test('allows non-Markdown preview sources only when rendered content is provided', () => {
    expect(canExportMarkdownPreviewSource(join('docs', 'report.docx'), true)).toBe(true)
    expect(canExportMarkdownPreviewSource(join('docs', 'report.docx'), false)).toBe(false)
  })
})
