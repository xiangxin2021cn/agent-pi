import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialId } from '../credentials/types.ts';
import type {
  WorkspaceConfig,
  WorkspaceMineruExtractionMode,
} from '../workspaces/types.ts';

export const MINERU_CREDENTIAL_NAME = 'mineru';
export const MINERU_TOKEN_URL = 'https://mineru.net/apiManage/token';
export const DEFAULT_MINERU_COMMAND = 'mineru-open-api';
export const MINERU_OPEN_API_VERSION = '0.5.9';
export const MINERU_OPEN_API_PACKAGE_NAME = 'mineru-open-api';

export type MineruTextExtractionFormat = 'md' | 'json';

export interface MineruCitationBlock {
  blockId: string;
  jsonPath: string;
  text: string;
  page?: number;
  pageIndex?: number;
  blockType?: string;
  bbox?: number[];
}

export interface MineruCitationExtractionOptions {
  limit?: number;
  maxTextChars?: number;
}

export interface MineruScanNoiseCleanupAudit {
  schemaVersion: 1;
  provider: 'mineru';
  enabled: boolean;
  removedLineCount: number;
  candidates: Array<{
    text: string;
    signature: string;
    occurrences: number;
    removedCount: number;
  }>;
}

export interface MineruMarkdownCleanupResult {
  markdown: string;
  audit: MineruScanNoiseCleanupAudit;
}

export interface MineruScanNoiseCleanupOptions {
  minOccurrences?: number;
  maxLineChars?: number;
}

export interface MineruExtractionManifest {
  schemaVersion: 1;
  provider: 'mineru';
  sourcePath: string;
  sourceName: string;
  markdownPath: string;
  rawJsonPath?: string;
  cleanupAuditPath?: string;
  model?: WorkspaceMineruExtractionMode;
  cleanupScanNoise: boolean;
  createdAt: string;
}

export interface MineruExtractionManifestInput {
  sourcePath: string;
  sourceName: string;
  markdownPath: string;
  rawJsonPath?: string;
  cleanupAuditPath?: string;
  model?: WorkspaceMineruExtractionMode;
  cleanupScanNoise?: boolean;
  createdAt?: string;
}

export interface MineruCommandRuntimePaths {
  appRootPath?: string;
  resourcesPath?: string;
  resourcesBasePath?: string;
  platform?: string;
  arch?: string;
  fileExists?: (path: string) => boolean;
}

export function getMineruCredentialId(workspaceId: string): CredentialId {
  return {
    type: 'document_api_token',
    workspaceId,
    name: MINERU_CREDENTIAL_NAME,
  };
}

export function isMineruExtractionEnabled(config: WorkspaceConfig | null | undefined): boolean {
  return config?.defaults?.documentExtraction?.mineru?.enabled === true;
}

export function shouldRunMineruExtraction(
  config: WorkspaceConfig | null | undefined,
  token: string | null | undefined,
): token is string {
  return isMineruExtractionEnabled(config) && typeof token === 'string' && token.trim().length > 0;
}

export function resolveMineruCommandPath(
  config: WorkspaceConfig | null | undefined,
  runtimePaths: MineruCommandRuntimePaths = {},
): string {
  const configured = config?.defaults?.documentExtraction?.mineru?.commandPath?.trim();
  if (configured) return configured;

  const fileExists = runtimePaths.fileExists ?? existsSync;
  for (const candidate of getBundledMineruCommandCandidates(runtimePaths)) {
    if (fileExists(candidate)) return candidate;
  }

  return DEFAULT_MINERU_COMMAND;
}

export function getBundledMineruCommandCandidates(runtimePaths: MineruCommandRuntimePaths = {}): string[] {
  const platform = runtimePaths.platform ?? getRuntimePlatform();
  const arch = normalizeMineruArch(runtimePaths.arch ?? getRuntimeArch());
  const platformKey = platform && arch ? `${platform}-${arch}` : undefined;
  const packageName = getMineruPlatformPackageName(platform, arch);
  const executableName = getMineruExecutableName(platform);
  const candidates: string[] = [];

  for (const resourcesDir of getMineruResourcesDirs(runtimePaths)) {
    if (platformKey) {
      candidates.push(join(resourcesDir, 'bin', platformKey, executableName));
      if (platform === 'win32') {
        candidates.push(join(resourcesDir, 'bin', platformKey, DEFAULT_MINERU_COMMAND));
      }
    }
  }

  if (packageName) {
    for (const nodeModulesDir of getMineruNodeModulesDirs(runtimePaths)) {
      candidates.push(join(nodeModulesDir, packageName, 'bin', executableName));
    }
  }

  for (const resourcesDir of getMineruResourcesDirs(runtimePaths)) {
    candidates.push(join(resourcesDir, 'bin', platform === 'win32' ? `${DEFAULT_MINERU_COMMAND}.cmd` : DEFAULT_MINERU_COMMAND));
    candidates.push(join(resourcesDir, 'bin', DEFAULT_MINERU_COMMAND));
  }

  for (const nodeModulesDir of getMineruNodeModulesDirs(runtimePaths)) {
    candidates.push(join(nodeModulesDir, '.bin', platform === 'win32' ? `${DEFAULT_MINERU_COMMAND}.cmd` : DEFAULT_MINERU_COMMAND));
  }

  return dedupePaths(candidates);
}

export function getMineruPlatformPackageName(platform?: string, arch?: string): string | undefined {
  const normalizedArch = normalizeMineruArch(arch);
  if (!platform || !normalizedArch) return undefined;
  if (!['darwin', 'linux', 'win32'].includes(platform)) return undefined;
  if (!['arm64', 'x64'].includes(normalizedArch)) return undefined;
  return `${MINERU_OPEN_API_PACKAGE_NAME}-${platform}-${normalizedArch}`;
}

export function resolveMineruMode(config: WorkspaceConfig | null | undefined): WorkspaceMineruExtractionMode | undefined {
  return config?.defaults?.documentExtraction?.mineru?.mode;
}

function getMineruExecutableName(platform?: string): string {
  return platform === 'win32' ? `${DEFAULT_MINERU_COMMAND}.exe` : DEFAULT_MINERU_COMMAND;
}

function getMineruResourcesDirs(runtimePaths: MineruCommandRuntimePaths): string[] {
  const envResourcesBase = getRuntimeEnv('CRAFT_RESOURCES_BASE');
  const dirs = [
    runtimePaths.resourcesBasePath ? join(runtimePaths.resourcesBasePath, 'resources') : undefined,
    envResourcesBase ? join(envResourcesBase, 'resources') : undefined,
    runtimePaths.resourcesPath ? join(runtimePaths.resourcesPath, 'app', 'resources') : undefined,
    runtimePaths.resourcesPath,
    runtimePaths.appRootPath ? join(runtimePaths.appRootPath, 'resources') : undefined,
    runtimePaths.appRootPath ? join(runtimePaths.appRootPath, 'dist', 'resources') : undefined,
  ];
  return dedupePaths(dirs.filter((dir): dir is string => !!dir));
}

function getMineruNodeModulesDirs(runtimePaths: MineruCommandRuntimePaths): string[] {
  const dirs = [
    runtimePaths.resourcesPath ? join(runtimePaths.resourcesPath, 'app', 'node_modules') : undefined,
    runtimePaths.appRootPath ? join(runtimePaths.appRootPath, 'node_modules') : undefined,
    runtimePaths.appRootPath ? join(runtimePaths.appRootPath, '..', '..', 'node_modules') : undefined,
    getRuntimeCwd() ? join(getRuntimeCwd()!, 'node_modules') : undefined,
  ];
  return dedupePaths(dirs.filter((dir): dir is string => !!dir));
}

function normalizeMineruArch(arch?: string): string | undefined {
  if (arch === 'x64' || arch === 'arm64') return arch;
  return undefined;
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function getRuntimePlatform(): string | undefined {
  return typeof process !== 'undefined' ? process.platform : undefined;
}

function getRuntimeArch(): string | undefined {
  return typeof process !== 'undefined' ? process.arch : undefined;
}

function getRuntimeEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function getRuntimeCwd(): string | undefined {
  return typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : undefined;
}

export function buildMineruMarkdownArgs(inputPath: string, mode?: WorkspaceMineruExtractionMode): string[] {
  return buildMineruTextExtractionArgs(inputPath, 'md', mode);
}

export function buildMineruJsonArgs(inputPath: string, mode?: WorkspaceMineruExtractionMode): string[] {
  return buildMineruTextExtractionArgs(inputPath, 'json', mode);
}

export function buildMineruTextExtractionArgs(
  inputPath: string,
  format: MineruTextExtractionFormat,
  mode?: WorkspaceMineruExtractionMode,
): string[] {
  const args = ['extract', inputPath, '-f', format];
  if (mode) {
    args.push('--model', mode);
  }
  return args;
}

export function buildMineruExtractionManifest(input: MineruExtractionManifestInput): MineruExtractionManifest {
  return {
    schemaVersion: 1,
    provider: 'mineru',
    sourcePath: input.sourcePath,
    sourceName: input.sourceName,
    markdownPath: input.markdownPath,
    ...(input.rawJsonPath ? { rawJsonPath: input.rawJsonPath } : {}),
    ...(input.cleanupAuditPath ? { cleanupAuditPath: input.cleanupAuditPath } : {}),
    ...(input.model ? { model: input.model } : {}),
    cleanupScanNoise: input.cleanupScanNoise === true,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function cleanMineruMarkdownScanNoise(
  markdown: string,
  options: MineruScanNoiseCleanupOptions = {},
): MineruMarkdownCleanupResult {
  const minOccurrences = Math.max(2, Math.min(options.minOccurrences ?? 3, 20));
  const maxLineChars = Math.max(20, Math.min(options.maxLineChars ?? 120, 300));
  const lines = markdown.split(/\r?\n/);
  const records = lines
    .map((line, index) => {
      const signature = getScanNoiseSignature(line, maxLineChars);
      return signature ? { line, index, signature } : undefined;
    })
    .filter((record): record is { line: string; index: number; signature: string } => record !== undefined);

  const groups = new Map<string, { lines: string[]; indexes: number[] }>();
  for (const record of records) {
    const group = groups.get(record.signature) ?? { lines: [], indexes: [] };
    group.lines.push(record.line.trim());
    group.indexes.push(record.index);
    groups.set(record.signature, group);
  }

  const candidates = [...groups.entries()]
    .filter(([, group]) => group.indexes.length >= minOccurrences)
    .map(([signature, group]) => ({
      text: pickRepresentativeNoiseLine(group.lines),
      signature,
      occurrences: group.indexes.length,
      removedCount: group.indexes.length,
      indexes: group.indexes,
    }))
    .sort((left, right) => right.occurrences - left.occurrences || left.signature.localeCompare(right.signature));

  const removeIndexes = new Set(candidates.flatMap(candidate => candidate.indexes));
  const cleaned = lines.filter((_line, index) => !removeIndexes.has(index)).join('\n');

  return {
    markdown: cleaned,
    audit: {
      schemaVersion: 1,
      provider: 'mineru',
      enabled: true,
      removedLineCount: removeIndexes.size,
      candidates: candidates.map(({ indexes: _indexes, ...candidate }) => candidate),
    },
  };
}

function getScanNoiseSignature(line: string, maxLineChars: number): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLineChars) return undefined;
  if (/^\|/.test(trimmed)) return undefined;
  if (/^[-:| ]{3,}$/.test(trimmed)) return undefined;
  if (/^```/.test(trimmed)) return undefined;

  const withoutMarkdown = trimmed
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutMarkdown.length < 4) return undefined;
  if (withoutMarkdown.split(/\s+/).length > 14) return undefined;

  const lower = withoutMarkdown.toLowerCase();
  const pageLike = /\b(page|p\.|页|第\s*\d+\s*页)\b/i.test(withoutMarkdown);
  return pageLike
    ? lower.replace(/\d+/g, '#')
    : lower;
}

function pickRepresentativeNoiseLine(lines: string[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? '';
}

const DEFAULT_CITATION_BLOCK_LIMIT = 200;
const DEFAULT_CITATION_TEXT_CHARS = 500;
const TEXT_KEYS = ['text', 'content', 'markdown', 'md', 'text_content', 'textContent', 'ocr_text', 'ocrText', 'html', 'latex'] as const;
const PAGE_INDEX_KEYS = ['page_idx', 'pageIndex', 'page_index', 'page_id', 'pageId'] as const;
const PAGE_NUMBER_KEYS = ['page', 'pageNo', 'page_no', 'pageNumber', 'page_number', 'page_num', 'pageNum'] as const;
const BLOCK_TYPE_KEYS = ['type', 'block_type', 'blockType', 'category', 'category_type', 'categoryType', 'layout_type', 'layoutType', 'tag', 'class'] as const;
const BBOX_KEYS = ['bbox', 'box', 'bounding_box', 'boundingBox', 'position'] as const;
const POLYGON_KEYS = ['poly', 'polygon', 'quad', 'points'] as const;
const NON_TEXT_TRAVERSAL_KEYS = new Set<string>([
  ...TEXT_KEYS,
  ...PAGE_INDEX_KEYS,
  ...PAGE_NUMBER_KEYS,
  ...BLOCK_TYPE_KEYS,
  ...BBOX_KEYS,
  ...POLYGON_KEYS,
]);

export function extractMineruCitationBlocks(
  rawJson: unknown,
  options: MineruCitationExtractionOptions = {},
): MineruCitationBlock[] {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_CITATION_BLOCK_LIMIT, 1_000));
  const maxTextChars = Math.max(80, Math.min(options.maxTextChars ?? DEFAULT_CITATION_TEXT_CHARS, 2_000));
  const blocks: MineruCitationBlock[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, path: string, pageContext?: MineruPageContext) => {
    if (blocks.length >= limit) return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, pageContext));
      return;
    }
    if (!isRecord(value)) return;

    const currentPage = readPageContext(value) ?? pageContext;
    const blockType = readStringField(value, BLOCK_TYPE_KEYS);
    const bbox = readBoundingBox(value);
    const directText = readStringField(value, TEXT_KEYS);
    const hasBlockMarker = !!blockType || !!bbox;
    const isBlockCandidate = !!currentPage && (hasBlockMarker || !!directText);

    if (isBlockCandidate) {
      const text = normalizeCitationText(collectText(value, maxTextChars), maxTextChars);
      const dedupeKey = `${currentPage.page ?? ''}:${currentPage.pageIndex ?? ''}:${blockType ?? ''}:${text}`;
      if (text && !seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        blocks.push({
          blockId: `mineru-block-${blocks.length + 1}`,
          jsonPath: path,
          text,
          ...(typeof currentPage.page === 'number' ? { page: currentPage.page } : {}),
          ...(typeof currentPage.pageIndex === 'number' ? { pageIndex: currentPage.pageIndex } : {}),
          ...(blockType ? { blockType } : {}),
          ...(bbox ? { bbox } : {}),
        });
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, appendJsonPath(path, key), currentPage);
      if (blocks.length >= limit) return;
    }
  };

  visit(rawJson, '$');
  return blocks;
}

interface MineruPageContext {
  page?: number;
  pageIndex?: number;
}

function readPageContext(value: Record<string, unknown>): MineruPageContext | undefined {
  for (const key of PAGE_INDEX_KEYS) {
    const pageIndex = readFiniteNumber(value[key]);
    if (pageIndex !== undefined) {
      return {
        pageIndex,
        page: pageIndex + 1,
      };
    }
  }
  for (const key of PAGE_NUMBER_KEYS) {
    const page = readFiniteNumber(value[key]);
    if (page !== undefined) {
      return { page };
    }
  }
  return undefined;
}

function collectText(value: unknown, maxChars: number): string {
  const parts: string[] = [];
  const visit = (item: unknown) => {
    if (parts.join(' ').length >= maxChars) return;
    if (typeof item === 'string') {
      const text = normalizeCitationText(item, maxChars);
      if (text) parts.push(text);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;

    for (const key of TEXT_KEYS) {
      const value = item[key];
      if (typeof value === 'string') {
        const text = normalizeCitationText(value, maxChars);
        if (text) parts.push(text);
      }
    }
    for (const [key, child] of Object.entries(item)) {
      if (NON_TEXT_TRAVERSAL_KEYS.has(key)) continue;
      visit(child);
    }
  };

  visit(value);
  return normalizeCitationText(parts.join(' '), maxChars);
}

function normalizeCitationText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars).trimEnd() : normalized;
}

function readStringField(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) {
      return normalizeCitationText(item, DEFAULT_CITATION_TEXT_CHARS);
    }
  }
  return undefined;
}

function readNumberArrayField(value: Record<string, unknown>, keys: readonly string[]): number[] | undefined {
  for (const key of keys) {
    const item = value[key];
    if (Array.isArray(item) && item.every(entry => typeof entry === 'number' && Number.isFinite(entry))) {
      return item;
    }
  }
  return undefined;
}

function readBoundingBox(value: Record<string, unknown>): number[] | undefined {
  const direct = readNumberArrayField(value, BBOX_KEYS);
  if (direct) return direct;

  for (const key of BBOX_KEYS) {
    const item = value[key];
    const fromObject = readBoundingBoxObject(item);
    if (fromObject) return fromObject;
  }

  for (const key of POLYGON_KEYS) {
    const item = value[key];
    const fromPolygon = readPolygonBoundingBox(item);
    if (fromPolygon) return fromPolygon;
  }

  return undefined;
}

function readBoundingBoxObject(value: unknown): number[] | undefined {
  if (!isRecord(value)) return undefined;
  const left = readFirstFiniteNumber(value, ['x0', 'xmin', 'left', 'l']);
  const top = readFirstFiniteNumber(value, ['y0', 'ymin', 'top', 't']);
  const right = readFirstFiniteNumber(value, ['x1', 'x2', 'xmax', 'right', 'r']);
  const bottom = readFirstFiniteNumber(value, ['y1', 'y2', 'ymax', 'bottom', 'b']);
  if ([left, top, right, bottom].every(entry => typeof entry === 'number')) {
    return [left!, top!, right!, bottom!];
  }
  const x = readFirstFiniteNumber(value, ['x']);
  const y = readFirstFiniteNumber(value, ['y']);
  const width = readFirstFiniteNumber(value, ['width', 'w']);
  const height = readFirstFiniteNumber(value, ['height', 'h']);
  if ([x, y, width, height].every(entry => typeof entry === 'number')) {
    return [x!, y!, x! + width!, y! + height!];
  }
  return undefined;
}

function readPolygonBoundingBox(value: unknown): number[] | undefined {
  const points = normalizePolygonPoints(value);
  if (points.length === 0) return undefined;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normalizePolygonPoints(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  if (value.every(entry => typeof entry === 'number' && Number.isFinite(entry)) && value.length >= 4) {
    const points: Array<[number, number]> = [];
    for (let index = 0; index + 1 < value.length; index += 2) {
      points.push([value[index] as number, value[index + 1] as number]);
    }
    return points;
  }
  return value
    .map((entry): [number, number] | undefined => {
      if (Array.isArray(entry) && entry.length >= 2) {
        const x = readFiniteNumber(entry[0]);
        const y = readFiniteNumber(entry[1]);
        return x !== undefined && y !== undefined ? [x, y] : undefined;
      }
      if (isRecord(entry)) {
        const x = readFirstFiniteNumber(entry, ['x', 'X']);
        const y = readFirstFiniteNumber(entry, ['y', 'Y']);
        return x !== undefined && y !== undefined ? [x, y] : undefined;
      }
      return undefined;
    })
    .filter((entry): entry is [number, number] => entry !== undefined);
}

function readFirstFiniteNumber(value: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const number = readFiniteNumber(value[key]);
    if (number !== undefined) return number;
  }
  return undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function appendJsonPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
