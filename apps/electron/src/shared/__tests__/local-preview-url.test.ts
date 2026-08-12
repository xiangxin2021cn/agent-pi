import { describe, expect, it } from 'bun:test'
import { dirname, join, resolve } from 'path'
import { parseLocalPreviewUrl, toLocalPreviewUrl } from '../local-preview-url'
import { isPathInsideRoot, resolveLocalPreviewFilePath } from '../local-preview-path'

const sampleHtml = process.platform === 'win32'
  ? 'C:\\Users\\tester\\out\\index.html'
  : '/tmp/report/index.html'

const spacedHtml = process.platform === 'win32'
  ? 'C:\\Users\\xiang\\Desktop\\agent\\Agent Pi Outputs\\260804-clear-cove\\arch_lift_sim_standalone.html'
  : '/tmp/agent/Agent Pi Outputs/260804-clear-cove/arch_lift_sim_standalone.html'

describe('local preview URLs', () => {
  it('round-trips an HTML path and keeps root-relative assets on the same origin', () => {
    const htmlUrl = toLocalPreviewUrl(sampleHtml)
    expect(htmlUrl).not.toContain('@')
    const parsed = parseLocalPreviewUrl(htmlUrl)
    expect(parsed?.relativePath).toBe('index.html')
    expect(parsed?.rootDir.replace(/\\/g, '/')).toBe(dirname(sampleHtml).replace(/\\/g, '/'))

    const assetUrl = new URL('/assets/app.js', htmlUrl)
    const asset = parseLocalPreviewUrl(assetUrl.href)
    expect(asset?.relativePath).toBe('assets/app.js')
    expect(asset?.rootDir).toBe(parsed?.rootDir)
  })

  it('round-trips a Windows-style HTML path', () => {
    const htmlUrl = toLocalPreviewUrl('C:\\Users\\tester\\out\\chart.html')
    const parsed = parseLocalPreviewUrl(htmlUrl)
    expect(parsed?.rootDir.replace(/\\/g, '/')).toBe('C:/Users/tester/out')
    expect(parsed?.relativePath).toBe('chart.html')
  })

  it('round-trips Official Outputs paths that contain spaces', () => {
    const htmlUrl = toLocalPreviewUrl(spacedHtml)
    expect(htmlUrl).not.toContain('@')
    const parsed = parseLocalPreviewUrl(htmlUrl)
    expect(parsed?.relativePath).toBe('arch_lift_sim_standalone.html')
    expect(parsed?.rootDir.replace(/\\/g, '/')).toBe(dirname(spacedHtml).replace(/\\/g, '/'))
  })

  it('still resolves after Chromium lowercases the hostname', () => {
    const htmlUrl = toLocalPreviewUrl(sampleHtml)
    const lowered = htmlUrl.replace(/:\/\/[^/]+/, (match) => match.toLowerCase())
    const parsed = parseLocalPreviewUrl(lowered)
    expect(parsed?.rootDir.replace(/\\/g, '/')).toBe(dirname(sampleHtml).replace(/\\/g, '/'))
  })

  it('rejects path traversal in the relative segment', () => {
    const htmlUrl = toLocalPreviewUrl(sampleHtml)
    const evil = htmlUrl.replace(/index\.html$/, '..%2Fsecret.txt')
    expect(parseLocalPreviewUrl(evil)).toBeNull()
  })

  it('still parses legacy userinfo URLs', () => {
    const dir = dirname(sampleHtml).replace(/\\/g, '/')
    const bytes = new TextEncoder().encode(dir)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const user = encodeURIComponent(
      btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
    )
    const legacy = `agent-preview://${user}@local/index.html`
    const parsed = parseLocalPreviewUrl(legacy)
    expect(parsed?.relativePath).toBe('index.html')
    expect(parsed?.rootDir.replace(/\\/g, '/')).toBe(dir)
  })
})

describe('local preview path resolution', () => {
  it('resolves sibling assets inside the artifact directory', () => {
    const htmlUrl = toLocalPreviewUrl(sampleHtml)
    const assetUrl = new URL('./vendor/chart.js', htmlUrl).href
    expect(resolveLocalPreviewFilePath(assetUrl)).toBe(resolve(dirname(sampleHtml), 'vendor', 'chart.js'))
  })

  it('blocks escaping the artifact directory', () => {
    const root = dirname(sampleHtml)
    expect(isPathInsideRoot(root, join(root, 'index.html'))).toBe(true)
    expect(isPathInsideRoot(root, resolve(root, '..', 'secret.txt'))).toBe(false)
  })
})
