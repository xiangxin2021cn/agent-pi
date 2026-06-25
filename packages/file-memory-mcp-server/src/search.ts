import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

export interface FileMemoryChunk {
  id: string;
  text?: string;
  textPath?: string;
  title?: string;
  page?: number | string;
  startLine?: number;
  endLine?: number;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}

export interface FileMemoryManifest {
  version?: number;
  sourceFile?: string;
  displayName?: string;
  description?: string;
  createdAt?: number;
  indexedAt?: number;
  chunks: FileMemoryChunk[];
}

export interface LoadedChunk extends FileMemoryChunk {
  text: string;
}

export interface LoadedFileMemoryManifest extends Omit<FileMemoryManifest, 'chunks'> {
  manifestPath: string;
  manifestDir: string;
  chunks: LoadedChunk[];
}

export interface SearchResult {
  chunk: LoadedChunk;
  score: number;
  snippet: string;
}

export function resolveManifestPath(args: { manifest?: string; indexDir?: string }): string {
  if (args.manifest) {
    return resolve(args.manifest);
  }
  if (args.indexDir) {
    return resolve(args.indexDir, 'manifest.json');
  }
  throw new Error('Missing --manifest <path> or --index-dir <path>');
}

export function loadManifestFromPath(manifestPath: string): LoadedFileMemoryManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifestDir = dirname(manifestPath);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as FileMemoryManifest;
  if (!Array.isArray(parsed.chunks)) {
    throw new Error('Manifest must include a chunks array');
  }

  const chunks: LoadedChunk[] = parsed.chunks.map((chunk, index) => {
    const id = String(chunk.id || `chunk-${index + 1}`);
    const text = loadChunkText(manifestDir, chunk, id);
    return {
      ...chunk,
      id,
      text,
    };
  });

  return {
    ...parsed,
    manifestPath,
    manifestDir,
    chunks,
  };
}

function loadChunkText(manifestDir: string, chunk: FileMemoryChunk, id: string): string {
  if (typeof chunk.text === 'string') {
    return chunk.text;
  }

  if (!chunk.textPath) {
    return '';
  }

  if (isAbsolute(chunk.textPath)) {
    throw new Error(`Chunk ${id} textPath must be relative to the manifest directory`);
  }

  const fullPath = resolve(manifestDir, chunk.textPath);
  const normalizedManifestDir = normalize(manifestDir);
  if (!fullPath.startsWith(normalizedManifestDir)) {
    throw new Error(`Chunk ${id} textPath escapes the manifest directory`);
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Chunk ${id} textPath not found: ${chunk.textPath}`);
  }

  return readFileSync(fullPath, 'utf-8');
}

export function searchManifest(
  manifest: LoadedFileMemoryManifest,
  query: string,
  limit = 5
): SearchResult[] {
  const normalizedQuery = normalizeForSearch(query);
  const tokens = tokenize(normalizedQuery);
  if (!normalizedQuery || tokens.length === 0) {
    return [];
  }

  return manifest.chunks
    .map((chunk) => {
      const score = scoreChunk(chunk, normalizedQuery, tokens);
      return { chunk, score, snippet: makeSnippet(chunk.text, normalizedQuery, tokens) };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

export function readChunk(manifest: LoadedFileMemoryManifest, chunkId: string): LoadedChunk | null {
  return manifest.chunks.find((chunk) => chunk.id === chunkId) ?? null;
}

export function formatManifestSummary(manifest: LoadedFileMemoryManifest): string {
  const lines = [
    `# File Memory Source`,
    ``,
    `Name: ${manifest.displayName || '(unnamed)'}`,
    `Source file: ${manifest.sourceFile || '(not specified)'}`,
    `Manifest: ${manifest.manifestPath}`,
    `Chunks: ${manifest.chunks.length}`,
  ];

  if (manifest.description) {
    lines.push(`Description: ${manifest.description}`);
  }
  if (manifest.indexedAt || manifest.createdAt) {
    lines.push(`Indexed at: ${new Date(manifest.indexedAt || manifest.createdAt || 0).toISOString()}`);
  }

  return lines.join('\n');
}

export function formatSearchResults(
  manifest: LoadedFileMemoryManifest,
  query: string,
  results: SearchResult[]
): string {
  if (results.length === 0) {
    return [
      `# File Memory Search`,
      ``,
      `Query: ${query}`,
      `Source file: ${manifest.sourceFile || '(not specified)'}`,
      ``,
      `No matching chunks were found.`,
    ].join('\n');
  }

  const lines = [
    `# File Memory Search`,
    ``,
    `Query: ${query}`,
    `Source file: ${manifest.sourceFile || '(not specified)'}`,
    ``,
    `## Results`,
  ];

  results.forEach((result, index) => {
    lines.push(
      ``,
      `${index + 1}. ${result.chunk.title || result.chunk.id}`,
      `   Chunk: ${result.chunk.id}`,
      `   Score: ${result.score}`,
      `   Citation: ${formatCitation(manifest, result.chunk)}`,
      `   Snippet: ${result.snippet}`
    );
  });

  return lines.join('\n');
}

export function formatChunk(manifest: LoadedFileMemoryManifest, chunk: LoadedChunk): string {
  return [
    `# ${chunk.title || chunk.id}`,
    ``,
    `Chunk: ${chunk.id}`,
    `Citation: ${formatCitation(manifest, chunk)}`,
    ``,
    chunk.text,
  ].join('\n');
}

function scoreChunk(chunk: LoadedChunk, normalizedQuery: string, tokens: string[]): number {
  const title = normalizeForSearch(chunk.title || '');
  const text = normalizeForSearch(chunk.text);
  const combined = `${title}\n${text}`;
  let score = 0;

  if (combined.includes(normalizedQuery)) {
    score += 50;
  }
  if (title.includes(normalizedQuery)) {
    score += 20;
  }

  for (const token of tokens) {
    const titleHits = countOccurrences(title, token);
    const textHits = countOccurrences(text, token);
    score += Math.min(titleHits * 6 + textHits * 2, 18);
  }

  return score;
}

function makeSnippet(text: string, normalizedQuery: string, tokens: string[]): string {
  const normalizedText = normalizeForSearch(text);
  let index = normalizedText.indexOf(normalizedQuery);

  if (index < 0) {
    for (const token of tokens) {
      index = normalizedText.indexOf(token);
      if (index >= 0) break;
    }
  }

  if (index < 0) {
    return compactWhitespace(text).slice(0, 240);
  }

  const start = Math.max(0, index - 100);
  const end = Math.min(text.length, index + normalizedQuery.length + 160);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${compactWhitespace(text.slice(start, end))}${suffix}`;
}

function formatCitation(manifest: LoadedFileMemoryManifest, chunk: LoadedChunk): string {
  const parts = [chunk.sourcePath || manifest.sourceFile || '(unknown source)'];
  if (chunk.page !== undefined) {
    parts.push(`page ${chunk.page}`);
  }
  if (chunk.startLine !== undefined || chunk.endLine !== undefined) {
    const start = chunk.startLine ?? '?';
    const end = chunk.endLine ?? start;
    parts.push(`lines ${start}-${end}`);
  }
  return parts.join(', ');
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,.;:!?()[\]{}"'`\\/|+-]+/).filter((token) => token.length >= 2)));
}

function normalizeForSearch(value: string): string {
  return compactWhitespace(value).toLocaleLowerCase();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function countOccurrences(value: string, token: string): number {
  if (!token) return 0;
  let count = 0;
  let position = value.indexOf(token);
  while (position >= 0) {
    count++;
    position = value.indexOf(token, position + token.length);
  }
  return count;
}
