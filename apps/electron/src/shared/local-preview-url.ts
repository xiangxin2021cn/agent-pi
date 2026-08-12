/**
 * Local HTML preview URLs.
 *
 * `agent-preview://<hex-labels>.preview/<relative>` keeps the artifact
 * directory in the hostname so relative and root-relative assets
 * (`./chart.js`, `/assets/app.js`) resolve inside that folder.
 *
 * Directory bytes are hex-encoded and split into 63-char DNS labels.
 * Hex is lowercase-safe: Chromium lowercases hostnames, which would
 * corrupt base64 userinfo (`user@host`) and leave iframes / BrowserViews blank.
 *
 * Path resolution (`resolveLocalPreviewFilePath`) lives in
 * `local-preview-path.ts` so the renderer can import this file without Node `path`.
 */

export const LOCAL_PREVIEW_SCHEME = 'agent-preview'
export const LOCAL_PREVIEW_HOST_TLD = 'preview'
/** @deprecated legacy userinfo host; still accepted by the parser */
export const LOCAL_PREVIEW_HOST = 'local'

const LABEL_MAX = 63
const HOST_MAX = 253

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function utf8ToHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToUtf8(hex: string): string | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

function encodeDirHost(dir: string): string {
  const hex = utf8ToHex(dir)
  const labels = hex.match(new RegExp(`.{1,${LABEL_MAX}}`, 'g')) ?? ['00']
  const host = `${labels.join('.')}.${LOCAL_PREVIEW_HOST_TLD}`
  if (host.length > HOST_MAX) {
    throw new Error('Local preview path is too long to encode as a URL origin')
  }
  return host
}

function decodeDirHost(hostname: string): string | null {
  const host = hostname.toLowerCase()
  const suffix = `.${LOCAL_PREVIEW_HOST_TLD}`
  if (!host.endsWith(suffix) || host.length <= suffix.length) return null
  const hex = host.slice(0, -suffix.length).replace(/\./g, '')
  return hexToUtf8(hex)
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function dirnamePosix(filePath: string): string {
  const posix = toPosixPath(filePath).replace(/\/+$/g, '')
  const index = posix.lastIndexOf('/')
  if (index < 0) return ''
  if (index === 0) return '/'
  return posix.slice(0, index)
}

function basenamePosix(filePath: string): string {
  const posix = toPosixPath(filePath).replace(/\/+$/g, '')
  const index = posix.lastIndexOf('/')
  return index >= 0 ? posix.slice(index + 1) : posix
}

export function toLocalPreviewUrl(filePath: string): string {
  const dir = dirnamePosix(filePath)
  const name = basenamePosix(filePath)
  if (!dir || !name) {
    throw new Error('Invalid local preview path')
  }
  const host = encodeDirHost(dir)
  const file = name.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `${LOCAL_PREVIEW_SCHEME}://${host}/${file}`
}

function decodeLegacyUserinfoDir(username: string): string | null {
  try {
    return base64UrlToUtf8(decodeURIComponent(username))
  } catch {
    return null
  }
}

export function parseLocalPreviewUrl(urlString: string): { rootDir: string; relativePath: string } | null {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }
  if (url.protocol !== `${LOCAL_PREVIEW_SCHEME}:`) return null

  let rootDir: string | null = null
  if (url.hostname.toLowerCase().endsWith(`.${LOCAL_PREVIEW_HOST_TLD}`)) {
    rootDir = decodeDirHost(url.hostname)
  } else if (url.hostname === LOCAL_PREVIEW_HOST && url.username) {
    rootDir = decodeLegacyUserinfoDir(url.username)
  }
  if (!rootDir) return null

  const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/g, ''))
  if (!relativePath) return null
  if (rootDir.includes('\0') || relativePath.includes('\0')) return null
  if (relativePath.split(/[\\/]/).includes('..')) return null
  return { rootDir, relativePath }
}
