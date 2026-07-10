import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dump, load } from 'js-yaml'

interface UpdateFileInfo {
  url: string
  sha512: string
  size?: number
  blockMapSize?: number
}

interface MacUpdateManifest {
  version: string
  files: UpdateFileInfo[]
  path: string
  sha512: string
  releaseDate?: string
  releaseName?: string | null
  releaseNotes?: unknown
  stagingPercentage?: number
  minimumSystemVersion?: string
}

export function mergeMacUpdateManifests(
  arm64Text: string,
  x64Text: string,
): MacUpdateManifest {
  const arm64 = parseManifest(arm64Text, 'arm64')
  const x64 = parseManifest(x64Text, 'x64')
  if (arm64.version !== x64.version) {
    throw new Error(`macOS update manifest versions differ: arm64=${arm64.version}, x64=${x64.version}`)
  }

  const files = uniqueFiles([...arm64.files, ...x64.files])
  requireArchitectureFile(files, 'arm64')
  requireArchitectureFile(files, 'x64')
  const primary = x64.files.find(file => file.url.toLowerCase().endsWith('.zip')) ?? x64.files[0]

  return {
    ...x64,
    version: x64.version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: latestReleaseDate(arm64.releaseDate, x64.releaseDate),
  }
}

function parseManifest(text: string, architecture: 'arm64' | 'x64'): MacUpdateManifest {
  const manifest = load(text) as Partial<MacUpdateManifest> | null
  if (!manifest || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`${architecture} macOS update manifest is missing version`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${architecture} macOS update manifest has no files`)
  }
  for (const file of manifest.files) {
    if (!file || typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
      throw new Error(`${architecture} macOS update manifest contains an invalid file entry`)
    }
  }
  requireArchitectureFile(manifest.files, architecture)
  return manifest as MacUpdateManifest
}

function requireArchitectureFile(files: UpdateFileInfo[], architecture: 'arm64' | 'x64'): void {
  if (!files.some(file => file.url.includes(architecture) && file.url.toLowerCase().endsWith('.zip'))) {
    throw new Error(`macOS update manifest is missing the ${architecture} ZIP`)
  }
}

function uniqueFiles(files: UpdateFileInfo[]): UpdateFileInfo[] {
  const byUrl = new Map<string, UpdateFileInfo>()
  for (const file of files) {
    const existing = byUrl.get(file.url)
    if (existing && existing.sha512 !== file.sha512) {
      throw new Error(`macOS update manifest has conflicting hashes for ${file.url}`)
    }
    byUrl.set(file.url, file)
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url))
}

function latestReleaseDate(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

if (import.meta.main) {
  const [arm64Path, x64Path, outputPath] = process.argv.slice(2)
  if (!arm64Path || !x64Path || !outputPath) {
    throw new Error('Usage: bun merge-mac-update-manifests.ts <arm64-yml> <x64-yml> <output-yml>')
  }
  const merged = mergeMacUpdateManifests(
    readFileSync(arm64Path, 'utf-8'),
    readFileSync(x64Path, 'utf-8'),
  )
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, dump(merged, { lineWidth: -1, noRefs: true }), 'utf-8')
  console.log(`Merged macOS update manifest for ${merged.version}: ${outputPath}`)
}
