import type { FolderSourceConfig, LoadedSource } from './types.ts';

export const KNOWLEDGE_BASE_METADATA_CATEGORY = 'knowledge_base' as const;
export const KNOWLEDGE_BASE_SCOPE = 'global' as const;
export const KNOWLEDGE_BASE_FILE_EXTENSIONS = ['.md', '.txt', '.json'] as const;

export type KnowledgeBaseFileExtension = typeof KNOWLEDGE_BASE_FILE_EXTENSIONS[number];

export interface KnowledgeBaseSourceMetadata {
  category: typeof KNOWLEDGE_BASE_METADATA_CATEGORY;
  collectionId?: string;
  knowledgeCategory: string;
  knowledgeFolder?: string;
  scope: typeof KNOWLEDGE_BASE_SCOPE;
  sourceKind: 'file-memory';
  fileExtension?: KnowledgeBaseFileExtension;
  sourceFilePath?: string;
  originalSourceFilePath?: string;
  tags?: string[];
  owner?: string;
  createdAt?: number;
}

export interface KnowledgeBaseFolderNode {
  name: string;
  path: string;
  children: KnowledgeBaseFolderNode[];
  sources: LoadedSource[];
}

export interface KnowledgeBaseCategorySuggestionInput {
  fileName: string;
  filePath?: string;
  existingCategories?: string[];
}

function getMetadata(source: LoadedSource | FolderSourceConfig): Record<string, unknown> | null {
  const config = 'config' in source ? source.config : source;
  const metadata = config.metadata;
  return metadata && typeof metadata === 'object' ? metadata : null;
}

export function isKnowledgeBaseSource(source: LoadedSource | FolderSourceConfig): boolean {
  return getMetadata(source)?.category === KNOWLEDGE_BASE_METADATA_CATEGORY;
}

export function getKnowledgeBaseCategory(source: LoadedSource | FolderSourceConfig): string | null {
  const metadata = getMetadata(source);
  if (metadata?.category !== KNOWLEDGE_BASE_METADATA_CATEGORY) return null;
  const category = typeof metadata.knowledgeCategory === 'string' ? metadata.knowledgeCategory : null;
  return normalizeKnowledgeBaseFolder(category);
}

export function getKnowledgeBaseFolder(source: LoadedSource | FolderSourceConfig): string | null {
  const metadata = getMetadata(source);
  if (metadata?.category !== KNOWLEDGE_BASE_METADATA_CATEGORY) return null;
  const folder = typeof metadata.knowledgeFolder === 'string' ? metadata.knowledgeFolder : null;
  return normalizeKnowledgeBaseFolder(folder) ?? getKnowledgeBaseCategory(source);
}

export function isSupportedKnowledgeBaseFile(filePath: string): boolean {
  return KNOWLEDGE_BASE_FILE_EXTENSIONS.includes(getExtension(filePath) as KnowledgeBaseFileExtension);
}

export function normalizeKnowledgeBaseFolder(value: string | null | undefined): string | null {
  const segments = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment && segment !== '.');
  return segments.length > 0 ? segments.join('/') : null;
}

export function buildKnowledgeBaseFolderTree(sources: LoadedSource[]): KnowledgeBaseFolderNode {
  const root: KnowledgeBaseFolderNode = { name: '', path: '', children: [], sources: [] };
  const byPath = new Map<string, KnowledgeBaseFolderNode>([['', root]]);

  for (const source of sources) {
    if (!isKnowledgeBaseSource(source)) continue;
    const folder = getKnowledgeBaseFolder(source) ?? 'General';
    const segments = folder.split('/');
    let current = root;
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = byPath.get(currentPath);
      if (!child) {
        child = { name: segment, path: currentPath, children: [], sources: [] };
        byPath.set(currentPath, child);
        current.children.push(child);
      }
      current = child;
    }
    current.sources.push(source);
  }

  sortFolderNode(root);
  return root;
}

export function suggestKnowledgeBaseCategory(input: KnowledgeBaseCategorySuggestionInput): string {
  const existing = (input.existingCategories ?? [])
    .map(normalizeKnowledgeBaseFolder)
    .filter((category): category is string => Boolean(category));
  const fileText = tokenizeForSuggestion(input.fileName);

  for (const category of existing) {
    const leaf = category.split('/').at(-1) ?? category;
    const categoryTokens = tokenizeForSuggestion(leaf);
    if (categoryTokens.length > 0 && categoryTokens.every(token => fileText.includes(token))) {
      return category;
    }
  }

  const parent = getUsefulParentFolder(input.filePath);
  if (parent) return parent;

  const lowerName = input.fileName.toLowerCase();
  if (lowerName.endsWith('.json')) return 'Data';
  if (lowerName.includes('review')) return 'Reviews';
  if (lowerName.includes('standard') || lowerName.includes('spec')) return 'Standards';
  return existing[0] ?? 'General';
}

function getExtension(filePath: string): string {
  const clean = filePath.split(/[?#]/, 1)[0] ?? filePath;
  const name = clean.split(/[\\/]/).pop() ?? clean;
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function sortFolderNode(node: KnowledgeBaseFolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.sources.sort((a, b) => a.config.name.localeCompare(b.config.name));
  for (const child of node.children) {
    sortFolderNode(child);
  }
}

function getUsefulParentFolder(filePath: string | undefined): string | null {
  const parent = filePath?.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0]?.trim();
  if (!parent || /^(agent pi outputs|outputs|attachments|reviews)$/i.test(parent)) return null;
  return parent;
}

function tokenizeForSuggestion(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/s$/i, ''))
    .filter(Boolean);
}
