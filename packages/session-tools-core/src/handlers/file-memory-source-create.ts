import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
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

    const content = readFileSync(sourceFilePath, 'utf-8');
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
      sourceFile: sourceFilePath,
      displayName,
      description: `Read-only file memory index generated from ${sourceFilePath}`,
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
        sourcePath: sourceFilePath,
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
            sourceFilePath,
            createdAt: now,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    };

    writeFileSync(sourceConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    writeFileSync(sourceGuidePath, buildGuide({ displayName, sourceFilePath, manifestPath, chunkCount: chunks.length, knowledgeBase }), 'utf-8');
    if (knowledgeBase) {
      upsertKnowledgeBaseRegistry(resolveKnowledgeBaseRegistryRoot(ctx), {
        sourceSlug: slug,
        name: displayName,
        sourceFilePath,
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
    }

    const autoEnable = args.autoEnable !== false;
    const validation = await handleSourceTest(ctx, { sourceSlug: slug, autoEnable });
    const validationText = validation.content.map(block => block.text).join('\n');
    const prefix = [
      `Created file memory source: ${slug}`,
      `Source file: ${sourceFilePath}`,
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
        sourceFilePath,
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
      chunks.push({
        id: `chunk-${String(index).padStart(4, '0')}`,
        title: `${options.titlePrefix} #${index}`,
        text,
        startLine: lineNumberAt(normalized, start),
        endLine: lineNumberAt(normalized, end),
      });
      index++;
    }

    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
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
