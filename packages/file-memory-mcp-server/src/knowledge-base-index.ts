import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  formatChunk,
  loadManifestFromPath,
  readChunk,
  searchManifest,
  type LoadedChunk,
  type LoadedFileMemoryManifest,
  type SearchResult,
} from './search.ts';

export interface KnowledgeBaseRegistryEntry {
  sourceSlug: string;
  name: string;
  sourceFilePath: string;
  originalSourceFilePath?: string;
  manifestPath?: string;
  workspacePath?: string;
  collectionId?: string;
  knowledgeCategory: string;
  knowledgeFolder: string;
  scope: 'global';
  sourceKind: 'file-memory';
  fileExtension: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBaseSearchInput {
  query: string;
  limit?: number;
  sourceSlugs?: string[];
  folder?: string;
}

export interface KnowledgeBaseSearchResult {
  sourceSlug: string;
  sourceName: string;
  folder: string;
  manifestPath: string;
  chunk: LoadedChunk;
  score: number;
  snippet: string;
  citation: string;
}

export interface KnowledgeBaseSearchOutput {
  query: string;
  indexStrategy: 'local-inverted-index';
  results: KnowledgeBaseSearchResult[];
}

export interface KnowledgeBaseRangeInput {
  startLine: number;
  endLine: number;
  contextLines?: number;
}

export interface KnowledgeBaseRangeOutput {
  sourceSlug: string;
  sourceName: string;
  sourceFilePath: string;
  startLine: number;
  endLine: number;
  text: string;
  citation: string;
}

export interface KnowledgeBaseCitationAuditInput {
  citations: Array<{ sourceSlug: string; chunkId: string }>;
  requiredSourceSlugs?: string[];
}

export interface KnowledgeBaseCitationAuditOutput {
  passed: boolean;
  checked: Array<{ sourceSlug: string; chunkId: string; ok: boolean; citation?: string; reason?: string }>;
  missingRequiredSourceSlugs: string[];
}

export function loadKnowledgeBaseRegistry(rootPath: string): KnowledgeBaseRegistryEntry[] {
  const registryPath = join(rootPath, 'knowledge-base', 'registry.json');
  if (!existsSync(registryPath)) return [];
  const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as { entries?: Partial<KnowledgeBaseRegistryEntry>[] };
  return Array.isArray(parsed.entries)
    ? parsed.entries.map(normalizeRegistryEntry).filter((entry): entry is KnowledgeBaseRegistryEntry => entry !== null)
    : [];
}

export function listKnowledgeBaseSources(rootPath: string): KnowledgeBaseRegistryEntry[] {
  return loadKnowledgeBaseRegistry(rootPath).sort((left, right) =>
    left.knowledgeFolder.localeCompare(right.knowledgeFolder) || left.name.localeCompare(right.name)
  );
}

export function searchKnowledgeBase(rootPath: string, input: KnowledgeBaseSearchInput): KnowledgeBaseSearchOutput {
  const limit = clampLimit(input.limit ?? 10);
  const documents = loadKnowledgeBaseSearchDocuments(rootPath, input);
  const candidateKeys = selectCandidateKeys(documents, input.query);
  const candidates = candidateKeys.size > 0
    ? documents.filter(document => candidateKeys.has(document.key))
    : [];
  const results: KnowledgeBaseSearchResult[] = [];

  const byManifest = new Map<string, KnowledgeBaseSearchDocument[]>();
  for (const document of candidates) {
    const items = byManifest.get(document.manifest.manifestPath) ?? [];
    items.push(document);
    byManifest.set(document.manifest.manifestPath, items);
  }

  for (const items of byManifest.values()) {
    const first = items[0];
    if (!first) continue;
    const candidateManifest: LoadedFileMemoryManifest = {
      ...first.manifest,
      chunks: items.map(item => item.chunk),
    };
    for (const result of searchManifest(candidateManifest, input.query, limit)) {
      results.push(toKnowledgeBaseSearchResult(first.entry, first.manifest, result));
    }
  }

  results.sort((a, b) => b.score - a.score || a.sourceSlug.localeCompare(b.sourceSlug) || a.chunk.id.localeCompare(b.chunk.id));
  return {
    query: input.query,
    indexStrategy: 'local-inverted-index',
    results: results.slice(0, limit),
  };
}

export function readKnowledgeBaseChunk(rootPath: string, sourceSlug: string, chunkId: string): { text: string; citation: string; chunk: LoadedChunk } | null {
  const resolved = resolveEntryAndManifest(rootPath, sourceSlug);
  if (!resolved) return null;
  const chunk = readChunk(resolved.manifest, chunkId);
  if (!chunk) return null;
  return {
    text: formatChunk(resolved.manifest, chunk),
    citation: formatKnowledgeBaseCitation(resolved.entry, chunk),
    chunk,
  };
}

export function readKnowledgeBaseRange(rootPath: string, sourceSlug: string, input: KnowledgeBaseRangeInput): KnowledgeBaseRangeOutput | null {
  const entry = listKnowledgeBaseSources(rootPath).find(item => item.sourceSlug === sourceSlug);
  if (!entry || !existsSync(entry.sourceFilePath)) return null;
  const lines = readFileSync(entry.sourceFilePath, 'utf-8').replace(/\r\n/g, '\n').split('\n');
  const context = Math.max(0, Math.min(input.contextLines ?? 0, 20));
  const startLine = Math.max(1, Math.min(input.startLine, input.endLine) - context);
  const endLine = Math.min(lines.length, Math.max(input.startLine, input.endLine) + context);
  const text = lines.slice(startLine - 1, endLine).join('\n');
  return {
    sourceSlug,
    sourceName: entry.name,
    sourceFilePath: entry.sourceFilePath,
    startLine,
    endLine,
    text,
    citation: `${entry.sourceFilePath}, lines ${startLine}-${endLine}`,
  };
}

export function findKnowledgeBaseClause(rootPath: string, clause: string, input: Omit<KnowledgeBaseSearchInput, 'query'> = {}): KnowledgeBaseSearchOutput {
  return searchKnowledgeBase(rootPath, {
    ...input,
    query: clause.trim(),
  });
}

export function findKnowledgeBaseTable(rootPath: string, table: string, input: Omit<KnowledgeBaseSearchInput, 'query'> = {}): KnowledgeBaseSearchOutput {
  return searchKnowledgeBase(rootPath, {
    ...input,
    query: table.trim(),
  });
}

export function auditKnowledgeBaseCitations(rootPath: string, input: KnowledgeBaseCitationAuditInput): KnowledgeBaseCitationAuditOutput {
  const checked = input.citations.map((citation) => {
    const resolved = resolveEntryAndManifest(rootPath, citation.sourceSlug);
    if (!resolved) {
      return { ...citation, ok: false, reason: 'source_not_found' };
    }
    const chunk = readChunk(resolved.manifest, citation.chunkId);
    if (!chunk) {
      return { ...citation, ok: false, reason: 'chunk_not_found' };
    }
    return {
      ...citation,
      ok: true,
      citation: formatKnowledgeBaseCitation(resolved.entry, chunk),
    };
  });
  const okSources = new Set(checked.filter(item => item.ok).map(item => item.sourceSlug));
  const missingRequiredSourceSlugs = (input.requiredSourceSlugs ?? []).filter(slug => !okSources.has(slug));
  return {
    passed: checked.length > 0 && checked.every(item => item.ok) && missingRequiredSourceSlugs.length === 0,
    checked,
    missingRequiredSourceSlugs,
  };
}

export function formatKnowledgeBaseSources(entries: KnowledgeBaseRegistryEntry[]): string {
  if (entries.length === 0) return '# Knowledge Base Sources\n\nNo knowledge base sources are registered.';
  const lines = ['# Knowledge Base Sources', ''];
  for (const entry of entries) {
    lines.push(`- ${entry.sourceSlug}: ${entry.name}`);
    lines.push(`  - Folder: ${entry.knowledgeFolder}`);
    lines.push(`  - Indexed file: ${entry.sourceFilePath}`);
    const manifestPath = resolveManifestPathForEntry(entry);
    if (manifestPath) lines.push(`  - Manifest: ${manifestPath}`);
  }
  return lines.join('\n');
}

export function formatKnowledgeBaseSearch(output: KnowledgeBaseSearchOutput): string {
  const lines = ['# Knowledge Base Search', '', `Query: ${output.query}`, ''];
  if (output.results.length === 0) {
    lines.push('No matching chunks were found in the selected knowledge base index.');
    return lines.join('\n');
  }
  output.results.forEach((result, index) => {
    lines.push(
      `${index + 1}. ${result.sourceName} / ${result.chunk.title || result.chunk.id}`,
      `   Source slug: ${result.sourceSlug}`,
      `   Chunk: ${result.chunk.id}`,
      `   Score: ${result.score}`,
      `   Citation: ${result.citation}`,
      `   Snippet: ${result.snippet}`,
      ''
    );
  });
  return lines.join('\n');
}

function normalizeRegistryEntry(value: Partial<KnowledgeBaseRegistryEntry>): KnowledgeBaseRegistryEntry | null {
  const sourceSlug = value.sourceSlug?.trim();
  const name = value.name?.trim();
  const sourceFilePath = value.sourceFilePath?.trim();
  const knowledgeCategory = value.knowledgeCategory?.trim();
  const knowledgeFolder = value.knowledgeFolder?.trim() || knowledgeCategory;
  if (!sourceSlug || !name || !sourceFilePath || !knowledgeCategory || !knowledgeFolder) return null;
  return {
    sourceSlug,
    name,
    sourceFilePath,
    originalSourceFilePath: value.originalSourceFilePath?.trim() || undefined,
    manifestPath: value.manifestPath?.trim() || undefined,
    workspacePath: value.workspacePath?.trim() || undefined,
    collectionId: value.collectionId,
    knowledgeCategory,
    knowledgeFolder,
    scope: 'global',
    sourceKind: 'file-memory',
    fileExtension: value.fileExtension || '.md',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  };
}

interface KnowledgeBaseSearchDocument {
  key: string;
  entry: KnowledgeBaseRegistryEntry;
  manifest: LoadedFileMemoryManifest;
  chunk: LoadedChunk;
  terms: Set<string>;
}

function loadKnowledgeBaseSearchDocuments(rootPath: string, input: KnowledgeBaseSearchInput): KnowledgeBaseSearchDocument[] {
  const sourceFilter = new Set(input.sourceSlugs ?? []);
  const folderFilter = input.folder?.trim().toLowerCase();
  const documents: KnowledgeBaseSearchDocument[] = [];

  for (const entry of listKnowledgeBaseSources(rootPath)) {
    if (sourceFilter.size > 0 && !sourceFilter.has(entry.sourceSlug)) continue;
    if (folderFilter && !entry.knowledgeFolder.toLowerCase().includes(folderFilter)) continue;

    const manifestPath = resolveManifestPathForEntry(entry);
    if (!manifestPath || !existsSync(manifestPath)) continue;
    const manifest = loadManifestFromPath(manifestPath);
    for (const chunk of manifest.chunks) {
      documents.push({
        key: `${entry.sourceSlug}:${chunk.id}`,
        entry,
        manifest,
        chunk,
        terms: tokenizeForIndex(`${entry.name} ${entry.knowledgeFolder} ${chunk.title ?? ''} ${flattenMetadata(chunk.metadata)} ${chunk.text}`),
      });
    }
  }

  return documents;
}

function selectCandidateKeys(documents: KnowledgeBaseSearchDocument[], query: string): Set<string> {
  const queryTerms = tokenizeForIndex(query);
  const inverted = new Map<string, Set<string>>();
  const byKey = new Map(documents.map(document => [document.key, document]));

  for (const document of documents) {
    for (const term of document.terms) {
      let keys = inverted.get(term);
      if (!keys) {
        keys = new Set<string>();
        inverted.set(term, keys);
      }
      keys.add(document.key);
    }
  }

  const candidateKeys = new Set<string>();
  for (const term of queryTerms) {
    for (const key of inverted.get(term) ?? []) {
      candidateKeys.add(key);
    }
  }

  const normalizedQuery = normalizeForIndex(query);
  for (const [key, document] of byKey) {
    if (normalizeForIndex(document.chunk.text).includes(normalizedQuery)) {
      candidateKeys.add(key);
    }
  }

  return candidateKeys;
}

function resolveEntryAndManifest(rootPath: string, sourceSlug: string): { entry: KnowledgeBaseRegistryEntry; manifest: LoadedFileMemoryManifest } | null {
  const entry = listKnowledgeBaseSources(rootPath).find(item => item.sourceSlug === sourceSlug);
  if (!entry) return null;
  const manifestPath = resolveManifestPathForEntry(entry);
  if (!manifestPath || !existsSync(manifestPath)) return null;
  return { entry, manifest: loadManifestFromPath(manifestPath) };
}

function resolveManifestPathForEntry(entry: KnowledgeBaseRegistryEntry): string | null {
  if (entry.manifestPath) return resolve(entry.manifestPath);
  if (entry.workspacePath) return join(entry.workspacePath, 'file-memory', entry.sourceSlug, 'manifest.json');
  return null;
}

function toKnowledgeBaseSearchResult(
  entry: KnowledgeBaseRegistryEntry,
  manifest: LoadedFileMemoryManifest,
  result: SearchResult
): KnowledgeBaseSearchResult {
  return {
    sourceSlug: entry.sourceSlug,
    sourceName: entry.name,
    folder: entry.knowledgeFolder,
    manifestPath: manifest.manifestPath,
    chunk: result.chunk,
    score: result.score,
    snippet: result.snippet,
    citation: formatKnowledgeBaseCitation(entry, result.chunk),
  };
}

function formatKnowledgeBaseCitation(entry: KnowledgeBaseRegistryEntry, chunk: LoadedChunk): string {
  const parts = [`${entry.sourceSlug}:${chunk.id}`, chunk.sourcePath || entry.sourceFilePath];
  if (chunk.page !== undefined) parts.push(`page ${chunk.page}`);
  if (chunk.startLine !== undefined || chunk.endLine !== undefined) {
    const start = chunk.startLine ?? '?';
    const end = chunk.endLine ?? start;
    parts.push(`lines ${start}-${end}`);
  }
  return parts.join(', ');
}

function clampLimit(value: number): number {
  return Math.max(1, Math.min(Math.floor(value), 50));
}

function tokenizeForIndex(value: string): Set<string> {
  const normalized = normalizeForIndex(value);
  const tokens = normalized.split(/[\s,.;:!?()[\]{}"'`\\/|+-]+/).filter(token => token.length >= 2);
  for (const segment of normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let size = 2; size <= 3; size++) {
      for (let index = 0; index <= segment.length - size; index++) {
        tokens.push(segment.slice(index, index + size));
      }
    }
  }
  return new Set(tokens);
}

function normalizeForIndex(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function flattenMetadata(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenMetadata).join(' ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(flattenMetadata).join(' ');
  return '';
}
