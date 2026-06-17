import { describe, expect, it } from 'bun:test'
import { classifyFile } from '../file-classification'

describe('classifyFile', () => {
  it('previews Office and spreadsheet files in-app', () => {
    expect(classifyFile('estimate.xlsx')).toEqual({ type: 'office', canPreview: true })
    expect(classifyFile('contract.docx')).toEqual({ type: 'office', canPreview: true })
    expect(classifyFile('briefing.pptx')).toEqual({ type: 'office', canPreview: true })
  })

  it('keeps archives external-only', () => {
    expect(classifyFile('bundle.zip')).toEqual({ type: null, canPreview: false })
  })
})
