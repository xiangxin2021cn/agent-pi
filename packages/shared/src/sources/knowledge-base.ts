import { extname } from 'node:path';
import type { FolderSourceConfig, LoadedSource } from './types.ts';

export const KNOWLEDGE_BASE_METADATA_CATEGORY = 'knowledge_base' as const;
export const KNOWLEDGE_BASE_SCOPE = 'global' as const;
export const KNOWLEDGE_BASE_FILE_EXTENSIONS = ['.md', '.txt', '.json'] as const;

export type KnowledgeBaseFileExtension = typeof KNOWLEDGE_BASE_FILE_EXTENSIONS[number];

export interface KnowledgeBaseSourceMetadata {
  category: typeof KNOWLEDGE_BASE_METADATA_CATEGORY;
  knowledgeCategory: string;
  knowledgeFolder?: string;
  scope: typeof KNOWLEDGE_BASE_SCOPE;
  sourceKind: 'file-memory';
  fileExtension?: KnowledgeBaseFileExtension;
  sourceFilePath?: string;
  createdAt?: number;
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
  return typeof metadata.knowledgeCategory === 'string' && metadata.knowledgeCategory.trim()
    ? metadata.knowledgeCategory.trim()
    : null;
}

export function isSupportedKnowledgeBaseFile(filePath: string): boolean {
  return KNOWLEDGE_BASE_FILE_EXTENSIONS.includes(extname(filePath).toLowerCase() as KnowledgeBaseFileExtension);
}
