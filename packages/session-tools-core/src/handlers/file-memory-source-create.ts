import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import type { SourceConfig, ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { getSourceConfigPath, getSourceGuidePath, getSourcePath, listSourceSlugs } from '../source-helpers.ts';
import { resolveScriptRuntime } from '../runtime/resolve-script-runtime.ts';
import { handleSourceTest } from './source-test.ts';

export interface FileMemorySourceCreateArgs {
  filePath: string;
  name?: string;
  sourceSlug?: string;
  originalSourceFilePath?: string;
  chunkSize?: number;
  overlap?: number;
  autoEnable?: boolean;
  knowledgeBase?: {
    category: string;
  };
}

interface ChunkDraft {
  id: string;
  title: string;
  text: string;
  startLine: number;
  endLine: number;
  metadata: {
    headingPath: string[];
    clauseRefs: string[];
    tableRefs: string[];
    boqRefs: string[];
  };
}

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const KNOWLEDGE_BASE_METADATA_CATEGORY = 'knowledge_base';
const KNOWLEDGE_BASE_SCOPE = 'global';
const KNOWLEDGE_BASE_COLLECTION_ID = 'local-file-memory';
const KNOWLEDGE_BASE_FILE_EXTENSIONS = new Set(['.md', '.txt', '.json']);

export async function handleFileMemorySourceCreate(
  ctx: SessionToolContext,
  args: FileMemorySourceCreateArgs
): Promise<ToolResult> {
  try {
    const sourceFilePath = resolveAllowedInputFile(ctx, args.filePath);
    const originalSourceFilePath = args.originalSourceFilePath?.trim() || sourceFilePath;
    const stats = ctx.fs.stat(sourceFilePath);
    if (stats.isDirectory()) {
      return errorResponse(`File memory sources require a file, not a directory: ${sourceFilePath}`);
    }
    if (stats.size > MAX_SOURCE_BYTES) {
      return errorResponse(`File is too large for the first file-memory indexer (${stats.size} bytes, max ${MAX_SOURCE_BYTES}). Convert or split it first.`);
    }

    const knowledgeBase = normalizeKnowledgeBase(args.knowledgeBase, sourceFilePath);
    if (args.knowledgeBase && !knowledgeBase) {
      return errorResponse('Knowledge base MCP sources support only .md, .txt, and .json files in the MVP. Convert or extract the source to one of those formats first.');
    }

    const displayName = args.name?.trim() || basename(sourceFilePath);
    const slug = chooseSlug(ctx.workspacePath, args.sourceSlug || displayName);
    const indexDir = join(ctx.workspacePath, 'file-memory', slug);
    const manifestPath = join(indexDir, 'manifest.json');
    const sourceDir = getSourcePath(ctx.workspacePath, slug);
    const sourceConfigPath = getSourceConfigPath(ctx.workspacePath, slug);
    const sourceGuidePath = getSourceGuidePath(ctx.workspacePath, slug);
    const indexedSourceFilePath = knowledgeBase
      ? copyKnowledgeBaseSourceFile(resolveKnowledgeBaseRegistryRoot(ctx), sourceFilePath, slug, knowledgeBase)
      : sourceFilePath;

    const content = readFileSync(indexedSourceFilePath, 'utf-8');
    const chunks = chunkText(content, {
      chunkSize: args.chunkSize ?? 3000,
      overlap: args.overlap ?? 300,
      titlePrefix: displayName,
    });

    if (chunks.length === 0) {
      return errorResponse(`No text content was found in ${sourceFilePath}. For PDF/Excel/images, run an extraction skill first and index the generated Markdown/JSON/TXT file.`);
    }

    const serverPath = resolveFileMemoryServerPath();
    const runtime = resolveScriptRuntime('bun', {
      isPackaged: process.env.CRAFT_IS_PACKAGED === '1' || process.env.CRAFT_IS_PACKAGED === 'true',
    });

    mkdirSync(indexDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });

    const now = Date.now();
    const manifest = {
      version: 1,
      sourceFile: indexedSourceFilePath,
      originalSourceFile: knowledgeBase ? sourceFilePath : undefined,
      displayName,
      description: `Read-only file memory index generated from ${indexedSourceFilePath}`,
      sourceSha256: createHash('sha256').update(content).digest('hex'),
      createdAt: now,
      indexedAt: now,
      knowledgeBase: knowledgeBase
        ? {
            category: knowledgeBase.knowledgeCategory,
            folder: knowledgeBase.knowledgeFolder,
            collectionId: knowledgeBase.collectionId,
            scope: knowledgeBase.scope,
            sourceKind: knowledgeBase.sourceKind,
            fileExtension: knowledgeBase.fileExtension,
          }
        : undefined,
      chunks: chunks.map(chunk => ({
        ...chunk,
        sourcePath: indexedSourceFilePath,
      })),
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const config: SourceConfig = {
      id: `${slug}_${randomUUID().slice(0, 8)}`,
      name: displayName,
      slug,
      enabled: false,
      provider: 'file-memory',
      type: 'mcp',
      mcp: {
        transport: 'stdio',
        authType: 'none',
        command: runtime.command,
        args: [...runtime.argsPrefix, serverPath, '--manifest', manifestPath],
      },
      isAuthenticated: true,
      connectionStatus: 'unknown',
      tagline: `Read-only evidence memory for ${displayName}`,
      metadata: knowledgeBase
        ? {
            category: KNOWLEDGE_BASE_METADATA_CATEGORY,
            collectionId: knowledgeBase.collectionId,
            knowledgeCategory: knowledgeBase.knowledgeCategory,
            knowledgeFolder: knowledgeBase.knowledgeFolder,
            scope: knowledgeBase.scope,
            sourceKind: knowledgeBase.sourceKind,
            fileExtension: knowledgeBase.fileExtension,
            sourceFilePath: indexedSourceFilePath,
            originalSourceFilePath,
            createdAt: now,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    writeFileSync(sourceConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    writeFileSync(sourceGuidePath, buildGuide({
      displayName,
      sourceFilePath: indexedSourceFilePath,
      originalSourceFilePath: knowledgeBase ? originalSourceFilePath : undefined,
      manifestPath,
      chunkCount: chunks.length,
      knowledgeBase,
    }), 'utf-8');
    if (knowledgeBase) {
      const knowledgeBaseRoot = resolveKnowledgeBaseRegistryRoot(ctx);
      upsertKnowledgeBaseRegistry(knowledgeBaseRoot, {
        sourceSlug: slug,
        name: displayName,
        sourceFilePath: indexedSourceFilePath,
        originalSourceFilePath,
        manifestPath,
        workspacePath: ctx.workspacePath,
        knowledgeCategory: knowledgeBase.knowledgeCategory,
        knowledgeFolder: knowledgeBase.knowledgeFolder,
        collectionId: knowledgeBase.collectionId,
        scope: knowledgeBase.scope,
        sourceKind: knowledgeBase.sourceKind,
        fileExtension: knowledgeBase.fileExtension,
        createdAt: now,
        updatedAt: now,
      });
      ensureKnowledgeBaseIndexSource(ctx, {
        knowledgeBaseRoot,
        serverPath,
        runtime,
        now,
      });
    }

    const autoEnable = args.autoEnable !== false;
    const validation = await handleSourceTest(ctx, { sourceSlug: slug, autoEnable });
    const validationText = validation.content.map(block => block.text).join('\n');
    const prefix = [
      `Created file memory source: ${slug}`,
      `Source file: ${indexedSourceFilePath}`,
      ...(knowledgeBase ? [`Original file: ${originalSourceFilePath}`] : []),
      `Manifest: ${manifestPath}`,
      `Chunks: ${chunks.length}`,
      `Runtime: ${runtime.command}`,
      `Server: ${serverPath}`,
      '',
      '## Validation',
      '',
    ].join('\n');

    return {
      content: [{
        type: 'text',
        text: `${prefix}${validationText}`,
      }],
      structuredContent: {
        sourceSlug: slug,
        sourceFilePath: indexedSourceFilePath,
        originalSourceFilePath: knowledgeBase ? originalSourceFilePath : undefined,
        manifestPath,
        sourceConfigPath,
        chunkCount: chunks.length,
        activated: autoEnable && validationText.includes('Source activated'),
      },
      isError: validation.isError,
    };
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }
}

interface KnowledgeBaseSourceMetadata {
  knowledgeCategory: string;
  knowledgeFolder: string;
  collectionId: string;
  scope: typeof KNOWLEDGE_BASE_SCOPE;
  sourceKind: 'file-memory';
  fileExtension: string;
}

interface KnowledgeBaseRegistryEntry extends KnowledgeBaseSourceMetadata {
  sourceSlug: string;
  name: string;
  sourceFilePath: string;
  originalSourceFilePath?: string;
  manifestPath?: string;
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
}

function normalizeKnowledgeBase(
  input: FileMemorySourceCreateArgs['knowledgeBase'],
  sourceFilePath: string
): KnowledgeBaseSourceMetadata | null {
  if (!input) return null;
  const fileExtension = extname(sourceFilePath).toLowerCase();
  if (!KNOWLEDGE_BASE_FILE_EXTENSIONS.has(fileExtension)) return null;
  const knowledgeCategory = normalizeKnowledgeBaseFolder(input.category);
  if (!knowledgeCategory) {
    throw new Error('Knowledge base category is required.');
  }
  return {
    knowledgeCategory,
    knowledgeFolder: knowledgeCategory,
    collectionId: KNOWLEDGE_BASE_COLLECTION_ID,
    scope: KNOWLEDGE_BASE_SCOPE,
    sourceKind: 'file-memory',
    fileExtension,
  };
}

function normalizeKnowledgeBaseFolder(value: string | null | undefined): string | null {
  const segments = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment && segment !== '.');
  return segments.length > 0 ? segments.join('/') : null;
}

function copyKnowledgeBaseSourceFile(
  rootPath: string,
  sourceFilePath: string,
  slug: string,
  knowledgeBase: KnowledgeBaseSourceMetadata
): string {
  const folderSegments = knowledgeBase.knowledgeFolder
    .split('/')
    .map(sanitizePathSegment)
    .filter(Boolean);
  const fileName = sanitizeFileName(basename(sourceFilePath)) || `${slug}${knowledgeBase.fileExtension}`;
  const targetDir = join(rootPath, 'knowledge-base', 'files', ...folderSegments, slug);
  const targetPath = join(targetDir, fileName);
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(sourceFilePath, targetPath);
  return targetPath;
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[<>:"|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120) || 'Untitled';
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180) || 'knowledge-source';
}

function resolveKnowledgeBaseRegistryRoot(ctx: SessionToolContext): string {
  return ctx.knowledgeBaseRegistryRootPath
    || process.env.CRAFT_KNOWLEDGE_BASE_HOME?.trim()
    || ctx.workspacePath;
}

function upsertKnowledgeBaseRegistry(rootPath: string, entry: KnowledgeBaseRegistryEntry): void {
  const registryDir = join(rootPath, 'knowledge-base');
  const registryPath = join(registryDir, 'registry.json');
  const current = readKnowledgeBaseRegistry(registryPath);
  const entries = current.entries.filter(item => item.sourceSlug !== entry.sourceSlug);
  entries.push(entry);
  entries.sort((left, right) =>
    left.knowledgeFolder.localeCompare(right.knowledgeFolder)
    || left.name.localeCompare(right.name)
  );
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify({ version: 1, entries }, null, 2), 'utf-8');
  writeFileSync(join(registryDir, 'index.md'), buildKnowledgeBaseIndexMarkdown(entries), 'utf-8');
}

function ensureKnowledgeBaseIndexSource(
  ctx: SessionToolContext,
  args: {
    knowledgeBaseRoot: string;
    serverPath: string;
    runtime: { command: string; argsPrefix: string[] };
    now: number;
  }
): void {
  const slug = 'knowledge-base-index';
  const sourceDir = getSourcePath(ctx.workspacePath, slug);
  mkdirSync(sourceDir, { recursive: true });

  const existing = ctx.loadSourceConfig(slug);
  const config: SourceConfig = {
    id: existing?.id || `${slug}_${randomUUID().slice(0, 8)}`,
    name: 'Knowledge Base Index',
    slug,
    enabled: existing?.enabled ?? false,
    provider: 'knowledge-base-index',
    type: 'mcp',
    mcp: {
      transport: 'stdio',
      authType: 'none',
      command: args.runtime.command,
      args: [...args.runtime.argsPrefix, args.serverPath, '--knowledge-base-root', args.knowledgeBaseRoot],
    },
    isAuthenticated: true,
    connectionStatus: existing?.connectionStatus ?? 'unknown',
    tagline: 'Deterministic full-text index across local knowledge-base file memories',
    metadata: {
      category: KNOWLEDGE_BASE_METADATA_CATEGORY,
      collectionId: KNOWLEDGE_BASE_COLLECTION_ID,
      knowledgeCategory: 'Knowledge Base',
      knowledgeFolder: 'Knowledge Base/_Index',
      scope: KNOWLEDGE_BASE_SCOPE,
      sourceKind: 'knowledge-base-index',
      sourceFilePath: join(args.knowledgeBaseRoot, 'knowledge-base', 'registry.json'),
      createdAt: existing?.metadata && typeof existing.metadata === 'object' && typeof existing.metadata.createdAt === 'number'
        ? existing.metadata.createdAt
        : args.now,
    },
    createdAt: existing?.createdAt ?? args.now,
    updatedAt: args.now,
  };

  writeFileSync(getSourceConfigPath(ctx.workspacePath, slug), JSON.stringify(config, null, 2), 'utf-8');
  writeFileSync(getSourceGuidePath(ctx.workspacePath, slug), buildKnowledgeBaseIndexGuide(args.knowledgeBaseRoot), 'utf-8');
}

function buildKnowledgeBaseIndexGuide(knowledgeBaseRoot: string): string {
  return [
    '# Knowledge Base Index',
    '',
    'Deterministic full-text MCP index for registered Agent Pi knowledge-base file memories.',
    '',
    '## Scope',
    '',
    `Registry root: ${knowledgeBaseRoot}`,
    '',
    'This source is a router and citation verifier. It does not load whole documents into context.',
    '',
    '## Required workflow',
    '',
    '- Call list_sources first to identify available source slugs and folders.',
    '- Call search_kb, find_clause, or find_table to locate candidate evidence.',
    '- Call read_chunk for each result used in an answer.',
    '- Use read_range only for exact line-range checks after a chunk has been found.',
    '- Call citation_audit before final source-backed conclusions.',
    '- If search_kb returns no match, say the selected knowledge base did not contain evidence instead of guessing.',
    '',
    '## Citation rule',
    '',
    'Every factual conclusion based on this source must cite sourceSlug:chunkId plus source file/page/line metadata returned by the tools.',
    '',
  ].join('\n');
}

function readKnowledgeBaseRegistry(registryPath: string): { version: 1; entries: KnowledgeBaseRegistryEntry[] } {
  if (!existsSync(registryPath)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as { entries?: KnowledgeBaseRegistryEntry[] };
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function ensureKnowledgeBaseIndexSourceForWorkspace(ctx: SessionToolContext): void {
  const knowledgeBaseRoot = resolveKnowledgeBaseRegistryRoot(ctx);
  const serverPath = resolveFileMemoryServerPath();
  const runtime = resolveScriptRuntime('bun', {
    isPackaged: process.env.CRAFT_IS_PACKAGED === '1' || process.env.CRAFT_IS_PACKAGED === 'true',
  });
  ensureKnowledgeBaseIndexSource(ctx, {
    knowledgeBaseRoot,
    serverPath,
    runtime,
    now: Date.now(),
  });
}

function buildKnowledgeBaseIndexMarkdown(entries: KnowledgeBaseRegistryEntry[]): string {
  const lines = [
    '# Agent Pi Knowledge Base Index',
    '',
    'This index lists local-global Knowledge Base file-memory MCP sources. Enable the relevant source slug in a session before using its file-memory tools.',
    '',
  ];

  if (entries.length === 0) {
    lines.push('_No knowledge base entries yet._', '');
    return lines.join('\n');
  }

  const folders = new Map<string, KnowledgeBaseRegistryEntry[]>();
  for (const entry of entries) {
    const items = folders.get(entry.knowledgeFolder) ?? [];
    items.push(entry);
    folders.set(entry.knowledgeFolder, items);
  }

  for (const [folder, items] of [...folders.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`## ${folder}`, '');
    for (const entry of [...items].sort((left, right) => left.name.localeCompare(right.name))) {
      lines.push(`- ${entry.name}`);
      lines.push(`  - Source slug: ${entry.sourceSlug}`);
      lines.push(`  - Indexed file: ${entry.sourceFilePath}`);
      if (entry.manifestPath) {
        lines.push(`  - Manifest: ${entry.manifestPath}`);
      }
      if (entry.originalSourceFilePath) {
        lines.push(`  - Original file: ${entry.originalSourceFilePath}`);
      }
      lines.push(`  - Extension: ${entry.fileExtension}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function resolveAllowedInputFile(ctx: SessionToolContext, inputPath: string): string {
  const base = ctx.workingDirectory || ctx.sessionPath || ctx.workspacePath;
  const resolved = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base, inputPath);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const realPath = realpathSync(resolved);
  const allowedRoots = [ctx.workingDirectory, ctx.sessionPath, ctx.workspacePath]
    .filter((value): value is string => Boolean(value))
    .map(root => realpathSync(root));

  if (!allowedRoots.some(root => isPathInside(realPath, root))) {
    throw new Error(`File path is outside the session working directory or workspace: ${realPath}`);
  }

  return realPath;
}

function resolveFileMemoryServerPath(): string {
  const explicit = process.env.CRAFT_FILE_MEMORY_MCP_SERVER;
  if (explicit && existsSync(explicit)) {
    return resolve(explicit);
  }

  const resourcesBase = process.env.CRAFT_RESOURCES_BASE;
  const appRoot = process.env.CRAFT_APP_ROOT;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  const candidates = [
    resourcesBase ? join(resourcesBase, 'resources', 'file-memory-mcp-server', 'index.js') : '',
    appRoot ? join(appRoot, 'resources', 'file-memory-mcp-server', 'index.js') : '',
    resourcesPath ? join(resourcesPath, 'app', 'resources', 'file-memory-mcp-server', 'index.js') : '',
    join(process.cwd(), 'apps', 'electron', 'resources', 'file-memory-mcp-server', 'index.js'),
    join(process.cwd(), 'packages', 'file-memory-mcp-server', 'dist', 'index.js'),
    resolveUpwards(process.cwd(), join('packages', 'file-memory-mcp-server', 'dist', 'index.js')),
  ].filter(Boolean);

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error('File memory MCP server was not found. Run electron:build:main or package the bundled file-memory-mcp-server resource.');
  }
  return resolve(found);
}

function chooseSlug(workspacePath: string, value: string): string {
  const fallbackHash = createHash('sha1').update(value).digest('hex').slice(0, 8);
  let base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  if (!base) {
    base = `file-memory-${fallbackHash}`;
  }
  if (!base.startsWith('file-memory-')) {
    base = `file-memory-${base}`;
  }

  const existing = new Set(listSourceSlugs(workspacePath));
  if (!existing.has(base)) return base;

  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

function chunkText(content: string, options: { chunkSize: number; overlap: number; titlePrefix: string }): ChunkDraft[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const chunkSize = Math.max(1000, Math.min(options.chunkSize, 12000));
  const overlap = Math.max(0, Math.min(options.overlap, Math.floor(chunkSize / 3), 2000));
  const chunks: ChunkDraft[] = [];

  let start = 0;
  let index = 1;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + chunkSize);
    if (end < normalized.length) {
      const nextBreak = normalized.lastIndexOf('\n\n', end);
      if (nextBreak > start + Math.floor(chunkSize * 0.5)) {
        end = nextBreak;
      }
    }

    const text = normalized.slice(start, end).trim();
    if (text) {
      const startLine = lineNumberAt(normalized, start);
      const endLine = lineNumberAt(normalized, end);
      chunks.push({
        id: `chunk-${String(index).padStart(4, '0')}`,
        title: buildChunkTitle(options.titlePrefix, index, text),
        text,
        startLine,
        endLine,
        metadata: extractChunkMetadata(normalized, startLine, text),
      });
      index++;
    }

    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function buildChunkTitle(titlePrefix: string, index: number, text: string): string {
  const heading = text.split('\n').map(line => line.trim()).find(line => /^#{1,6}\s+\S/.test(line));
  if (!heading) return `${titlePrefix} #${index}`;
  return `${titlePrefix} #${index} - ${heading.replace(/^#{1,6}\s+/, '').trim()}`;
}

function extractChunkMetadata(content: string, startLine: number, text: string): ChunkDraft['metadata'] {
  return {
    headingPath: extractHeadingPath(content, startLine),
    clauseRefs: uniqueMatches(text, /\b(?:clause|section|cl\.?)\s*([A-Z]?\d{1,4}(?:\.\d+)*(?:\([a-z0-9]+\))*)\b/gi),
    tableRefs: extractTableRefs(text),
    boqRefs: uniqueMatches(text, /\b\d+\/\d+(?:\.\d+)*(?:\([a-z0-9]+\))*/gi),
  };
}

function extractHeadingPath(content: string, startLine: number): string[] {
  const lines = content.split('\n');
  const stack: string[] = [];
  for (let lineIndex = 0; lineIndex < Math.min(startLine, lines.length); lineIndex++) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[lineIndex] ?? '');
    if (!match) continue;
    const level = match[1]!.length;
    stack.length = level - 1;
    stack[level - 1] = match[2]!.trim();
  }
  return stack.filter(Boolean);
}

function extractTableRefs(text: string): string[] {
  const refs: string[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length - 1; index++) {
    const current = lines[index]?.trim() ?? '';
    const next = lines[index + 1]?.trim() ?? '';
    if (!current.startsWith('|') || !current.endsWith('|')) continue;
    if (!/^\|?[\s:-]+\|[\s|:-]*$/.test(next)) continue;
    refs.push(current.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()).join(' | '));
  }
  return [...new Set(refs)];
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? match[0])?.trim();
    if (value) values.add(value);
  }
  return [...values];
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, content.length); index++) {
    if (content.charCodeAt(index) === 10) {
      line++;
    }
  }
  return line;
}

function buildGuide(args: {
  displayName: string;
  sourceFilePath: string;
  originalSourceFilePath?: string;
  manifestPath: string;
  chunkCount: number;
  knowledgeBase?: KnowledgeBaseSourceMetadata | null;
}): string {
  return [
    `# ${args.displayName}`,
    ``,
    `Read-only file memory source for one indexed file.`,
    ``,
    `## Scope`,
    ``,
    `Use this source only for facts found in this indexed file:`,
    ``,
    `- ${args.sourceFilePath}`,
    ...(args.originalSourceFilePath
      ? [
          ``,
          `Original imported file:`,
          ``,
          `- ${args.originalSourceFilePath}`,
        ]
      : []),
    ``,
    `## Guidelines`,
    ``,
    `- Call get_file_memory_manifest first if you need the source overview.`,
    `- Call search_file_memory before answering questions that depend on this file.`,
    `- Call read_file_memory_chunk when a search result needs exact wording.`,
    `- Cite the returned chunk id and source file/page/line metadata when using evidence.`,
    `- If search_file_memory returns no match, say the indexed file did not contain evidence instead of guessing.`,
    ``,
    `## Context`,
    ``,
    `Manifest: ${args.manifestPath}`,
    `Chunks: ${args.chunkCount}`,
    ...(args.knowledgeBase
      ? [
          ``,
          `## Knowledge Base`,
          ``,
          `Category: ${args.knowledgeBase.knowledgeCategory}`,
          `Folder: ${args.knowledgeBase.knowledgeFolder}`,
          `Collection: ${args.knowledgeBase.collectionId}`,
          `Scope: ${args.knowledgeBase.scope}`,
          `Source kind: ${args.knowledgeBase.sourceKind}`,
          `File extension: ${args.knowledgeBase.fileExtension}`,
          ``,
          `This source is listed in the user's knowledge base, but it should only be used after explicit user selection in a workspace or session.`,
        ]
      : []),
    ``,
  ].join('\n');
}

function isPathInside(filePath: string, root: string): boolean {
  const rel = relative(root, filePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveUpwards(base: string, relativePath: string): string {
  let dir = resolve(base);
  while (true) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return candidate;
    dir = parent;
  }
}
