import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeKnowledgeBaseFolder, type KnowledgeBaseFileExtension } from '../sources/knowledge-base.ts';

export interface KnowledgeBaseRegistryEntry {
  sourceSlug: string;
  name: string;
  sourceFilePath: string;
  workspacePath?: string;
  collectionId?: string;
  knowledgeCategory: string;
  knowledgeFolder: string;
  scope: 'global';
  sourceKind: 'file-memory';
  fileExtension: KnowledgeBaseFileExtension;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBaseRegistry {
  version: 1;
  entries: KnowledgeBaseRegistryEntry[];
}

export function getKnowledgeBaseRegistryPath(rootPath: string): string {
  return join(rootPath, 'knowledge-base', 'registry.json');
}

export function loadKnowledgeBaseRegistry(rootPath: string): KnowledgeBaseRegistry {
  const registryPath = getKnowledgeBaseRegistryPath(rootPath);
  if (!existsSync(registryPath)) {
    return { version: 1, entries: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as Partial<KnowledgeBaseRegistry>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.map(normalizeRegistryEntry).filter((entry): entry is KnowledgeBaseRegistryEntry => entry !== null)
        : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveKnowledgeBaseRegistry(rootPath: string, registry: KnowledgeBaseRegistry): void {
  const registryPath = getKnowledgeBaseRegistryPath(rootPath);
  mkdirSync(join(rootPath, 'knowledge-base'), { recursive: true });
  writeFileSync(registryPath, JSON.stringify({
    version: 1,
    entries: registry.entries.map(normalizeRegistryEntry).filter(Boolean),
  }, null, 2), 'utf-8');
}

export function upsertKnowledgeBaseRegistryEntry(rootPath: string, entry: KnowledgeBaseRegistryEntry): KnowledgeBaseRegistry {
  const registry = loadKnowledgeBaseRegistry(rootPath);
  const normalized = normalizeRegistryEntry(entry);
  if (!normalized) return registry;

  const entries = registry.entries.filter(item => item.sourceSlug !== normalized.sourceSlug);
  entries.push(normalized);
  entries.sort((left, right) =>
    left.knowledgeFolder.localeCompare(right.knowledgeFolder)
    || left.name.localeCompare(right.name)
  );

  const next: KnowledgeBaseRegistry = { version: 1, entries };
  saveKnowledgeBaseRegistry(rootPath, next);
  return next;
}

function normalizeRegistryEntry(value: Partial<KnowledgeBaseRegistryEntry>): KnowledgeBaseRegistryEntry | null {
  const sourceSlug = value.sourceSlug?.trim();
  const name = value.name?.trim();
  const sourceFilePath = value.sourceFilePath?.trim();
  const knowledgeCategory = normalizeKnowledgeBaseFolder(value.knowledgeCategory);
  const knowledgeFolder = normalizeKnowledgeBaseFolder(value.knowledgeFolder) ?? knowledgeCategory;
  const fileExtension = value.fileExtension;
  if (!sourceSlug || !name || !sourceFilePath || !knowledgeCategory || !knowledgeFolder || !isKnowledgeBaseFileExtension(fileExtension)) {
    return null;
  }

  const now = Date.now();
  return {
    sourceSlug,
    name,
    sourceFilePath,
    workspacePath: value.workspacePath,
    collectionId: value.collectionId,
    knowledgeCategory,
    knowledgeFolder,
    scope: 'global',
    sourceKind: 'file-memory',
    fileExtension,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
  };
}

function isKnowledgeBaseFileExtension(value: unknown): value is KnowledgeBaseFileExtension {
  return value === '.md' || value === '.txt' || value === '.json';
}
