import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { buildAttachmentDialogSpec, collectAttachmentDialogFiles } from './files'

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
  test('expands selected folders into path-backed file attachments', async () => {
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
    const names = result.attachments.map(a => a.name).sort()

    expect(names).toEqual([
      `${basename(selected)}/brief.md`,
      `${basename(selected)}/nested/scope.txt`,
    ])
    expect(result.skippedCount).toBeGreaterThanOrEqual(2)
    expect(result.truncated).toBe(false)
  })

  test('keeps explicitly selected hidden files but skips hidden files during folder expansion', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'docs')
    const explicitHidden = join(selected, '.env')
    await mkdir(selected, { recursive: true })
    await writeFile(explicitHidden, 'API_KEY=example')
    await writeFile(join(selected, 'visible.txt'), 'visible')

    const result = await collectAttachmentDialogFiles([selected, explicitHidden])
    const names = result.attachments.map(a => a.name).sort()

    expect(names).toEqual(['.env', 'docs/visible.txt'])
  })

  test('truncates when a folder contains more files than the configured cap', async () => {
    const root = await makeTempRoot()
    const selected = join(root, 'many')
    await mkdir(selected, { recursive: true })
    await writeFile(join(selected, 'a.txt'), 'a')
    await writeFile(join(selected, 'b.txt'), 'b')
    await writeFile(join(selected, 'c.txt'), 'c')

    const result = await collectAttachmentDialogFiles([selected], { maxFiles: 2 })

    expect(result.attachments).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})

describe('buildAttachmentDialogSpec', () => {
  test('defaults to file selection so Windows shows files in the picker', () => {
    const spec = buildAttachmentDialogSpec()

    expect(spec.title).toBe('Attach files')
    expect(spec.properties).toContain('openFile')
    expect(spec.properties).toContain('multiSelections')
    expect(spec.properties).not.toContain('openDirectory')
  })

  test('uses directory-only mode when attaching a folder', () => {
    const spec = buildAttachmentDialogSpec('folders')

    expect(spec.title).toBe('Attach folder')
    expect(spec.properties).toContain('openDirectory')
    expect(spec.properties).not.toContain('openFile')
  })
})
