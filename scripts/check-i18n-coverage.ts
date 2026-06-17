#!/usr/bin/env bun
/**
 * check-i18n-coverage.ts — Ensure literal i18n callsites resolve.
 *
 * Scans source files for static `t('key')`, `i18n.t('key')`, and
 * `<Trans i18nKey="key">` references. Dynamic keys are intentionally skipped;
 * those are covered by runtime missing-key warnings.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..')
const LOCALES_DIR = resolve(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales')
const EN_PATH = resolve(LOCALES_DIR, 'en.json')

const SOURCE_ROOTS = [
  resolve(ROOT, 'apps'),
  resolve(ROOT, 'packages'),
]

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

type Locale = Record<string, string>

interface Reference {
  key: string
  file: string
  line: number
  kind: 't' | 'i18n.t' | 'Trans'
}

const en = JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Locale
const enKeys = new Set(Object.keys(en))

function hasLocaleKey(key: string): boolean {
  if (enKeys.has(key)) return true
  return PLURAL_SUFFIXES.some(suffix => enKeys.has(`${key}${suffix}`))
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue

    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      collectFiles(path, out)
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      out.push(path)
    }
  }
  return out
}

function lineForIndex(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++
  }
  return line
}

function addMatches(
  source: string,
  file: string,
  regex: RegExp,
  kind: Reference['kind'],
  refs: Reference[],
): void {
  for (const match of source.matchAll(regex)) {
    const key = match[2]
    if (!key) continue
    refs.push({
      key,
      file,
      line: lineForIndex(source, match.index ?? 0),
      kind,
    })
  }
}

const references: Reference[] = []

for (const root of SOURCE_ROOTS) {
  for (const file of collectFiles(root)) {
    const source = readFileSync(file, 'utf-8')
    const rel = relative(ROOT, file)

    addMatches(source, rel, /\bi18n\.t\s*\(\s*(['"])([^'"`\r\n]+)\1/g, 'i18n.t', references)
    addMatches(source, rel, /(?<![\w$.])t\s*\(\s*(['"])([^'"`\r\n]+)\1/g, 't', references)
    addMatches(source, rel, /i18nKey\s*=\s*(?:\{\s*)?(['"])([^'"`\r\n]+)\1/g, 'Trans', references)
  }
}

const missing = references.filter(ref => !hasLocaleKey(ref.key))

if (missing.length > 0) {
  console.error(`i18n coverage failed: ${missing.length} literal key reference(s) missing from en.json`)
  for (const ref of missing.slice(0, 100)) {
    console.error(`  ${ref.file}:${ref.line} ${ref.kind}('${ref.key}')`)
  }
  if (missing.length > 100) {
    console.error(`  ...and ${missing.length - 100} more`)
  }
  process.exit(1)
}

const uniqueKeys = new Set(references.map(ref => ref.key))
console.log(`i18n coverage OK (${references.length} literal references, ${uniqueKeys.size} unique keys)`)
