/**
 * agent-preview:// protocol — serve a local HTML artifact and its sibling
 * assets as a real origin so scripts, relative CSS/JS, and `/assets/` paths work.
 *
 * Scheme must be registered with thumbnail:// in a single
 * `protocol.registerSchemesAsPrivileged` call (Electron allows only one).
 */

import { net, protocol, session } from 'electron'
import { extname, isAbsolute } from 'path'
import { pathToFileURL } from 'url'
import { resolveLocalPreviewFilePath } from '../shared/local-preview-path'
import { LOCAL_PREVIEW_SCHEME } from '../shared/local-preview-url'
import { mainLog } from './logger'

/** Must match `BROWSER_PANE_SESSION_PARTITION` in browser-pane-manager.ts */
const BROWSER_PANE_SESSION_PARTITION = 'persist:browser-pane'

const PREVIEW_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function handleLocalPreviewRequest(request: Request): Promise<Response> {
  try {
    const filePath = resolveLocalPreviewFilePath(request.url)
    if (!filePath || !isAbsolute(filePath)) {
      mainLog.warn(`Local preview rejected: ${request.url}`)
      return new Response(null, { status: 400 })
    }
    const fileResponse = await net.fetch(pathToFileURL(filePath).href)
    const mime = PREVIEW_MIME[extname(filePath).toLowerCase()]
    if (!mime) return fileResponse
    const headers = new Headers(fileResponse.headers)
    headers.set('Content-Type', mime)
    return new Response(fileResponse.body, { status: fileResponse.status, statusText: fileResponse.statusText, headers })
  } catch (error) {
    mainLog.error('Local preview protocol error:', error)
    return new Response(null, { status: 500 })
  }
}

export function registerLocalPreviewHandler(): void {
  protocol.handle(LOCAL_PREVIEW_SCHEME, handleLocalPreviewRequest)
  session.fromPartition(BROWSER_PANE_SESSION_PARTITION).protocol.handle(LOCAL_PREVIEW_SCHEME, handleLocalPreviewRequest)
  mainLog.info(`Registered ${LOCAL_PREVIEW_SCHEME}:// protocol handler (default + browser-pane session)`)
}

export const LOCAL_PREVIEW_SCHEME_REGISTRATION = {
  scheme: LOCAL_PREVIEW_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: true,
    allowServiceWorkers: true,
  },
}
