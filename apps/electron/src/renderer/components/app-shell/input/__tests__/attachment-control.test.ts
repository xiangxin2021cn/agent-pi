import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../FreeFormInput.tsx'), 'utf8')

describe('FreeFormInput attachment control', () => {
  test('primary attachment button opens the file picker directly', () => {
    expect(source).toContain("onClick={() => void handleAttachClick('files')}")
    expect(source).toContain("tooltip={t('chat.attachFilesTooltip')}")
  })

  test('folder attachment is a menu action opened after Radix closes the menu', () => {
    expect(source).toContain('const handleAttachmentMenuSelect = (mode: AttachmentDialogMode)')
    expect(source).toContain('window.setTimeout(() => {')
    expect(source).toContain("onSelect={() => handleAttachmentMenuSelect('folders')}")
    expect(source).not.toContain("onClick={() => void handleAttachClick('folders')}")
  })
})
