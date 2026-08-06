import { describe, expect, it } from 'bun:test'
import { classifyFile } from '../file-classification'

describe('classifyFile', () => {
  it('previews spreadsheet files with a table overlay and Office files as documents', () => {
    expect(classifyFile('estimate.xlsx')).toEqual({ type: 'spreadsheet', canPreview: true })
    expect(classifyFile('estimate.xlsm')).toEqual({ type: 'spreadsheet', canPreview: true })
    expect(classifyFile('contract.docx')).toEqual({ type: 'office', canPreview: true })
    expect(classifyFile('briefing.pptx')).toEqual({ type: 'office', canPreview: true })
  })

  it('previews HTML files with the HTML overlay instead of the code viewer', () => {
    expect(classifyFile('arch_lift_sim_standalone.html')).toEqual({ type: 'html', canPreview: true })
    expect(classifyFile('report.HTM')).toEqual({ type: 'html', canPreview: true })
  })

  it('keeps SVG as image preview ahead of code', () => {
    expect(classifyFile('icon.svg')).toEqual({ type: 'image', canPreview: true })
  })

  it('keeps archives external-only', () => {
    expect(classifyFile('bundle.zip')).toEqual({ type: null, canPreview: false })
  })
})
