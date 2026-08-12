import { isAbsolute, relative, resolve } from 'path'
import { parseLocalPreviewUrl } from './local-preview-url'

export function isPathInsideRoot(root: string, target: string): boolean {
  const rootResolved = resolve(root)
  const targetResolved = resolve(target)
  const rel = relative(rootResolved, targetResolved)
  if (!rel) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function resolveLocalPreviewFilePath(urlString: string): string | null {
  const parsed = parseLocalPreviewUrl(urlString)
  if (!parsed) return null
  const root = resolve(parsed.rootDir)
  const target = resolve(root, parsed.relativePath)
  if (!isPathInsideRoot(root, target)) return null
  return target
}
