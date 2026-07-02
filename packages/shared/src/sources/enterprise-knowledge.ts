import { extname } from 'node:path';
import type { FolderSourceConfig, LoadedSource } from './types.ts';

export const ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY = 'enterprise_kb' as const;
export const ENTERPRISE_KNOWLEDGE_SCOPE = 'global' as const;
export const ENTERPRISE_KNOWLEDGE_FILE_EXTENSIONS = ['.md', '.txt', '.json'] as const;

export type EnterpriseKnowledgeFileExtension = typeof ENTERPRISE_KNOWLEDGE_FILE_EXTENSIONS[number];

export interface EnterpriseKnowledgeSourceMetadata {
  category: typeof ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY;
  knowledgeCategory: string;
  scope: typeof ENTERPRISE_KNOWLEDGE_SCOPE;
  sourceKind: 'file-memory';
  fileExtension?: EnterpriseKnowledgeFileExtension;
  sourceFilePath?: string;
  createdAt?: number;
}

function getMetadata(source: LoadedSource | FolderSourceConfig): Record<string, unknown> | null {
  const config = 'config' in source ? source.config : source;
  const metadata = config.metadata;
  return metadata && typeof metadata === 'object' ? metadata : null;
}

export function isEnterpriseKnowledgeSource(source: LoadedSource | FolderSourceConfig): boolean {
  return getMetadata(source)?.category === ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY;
}

export function getEnterpriseKnowledgeCategory(source: LoadedSource | FolderSourceConfig): string | null {
  const metadata = getMetadata(source);
  if (metadata?.category !== ENTERPRISE_KNOWLEDGE_METADATA_CATEGORY) return null;
  return typeof metadata.knowledgeCategory === 'string' && metadata.knowledgeCategory.trim()
    ? metadata.knowledgeCategory.trim()
    : null;
}

export function isSupportedEnterpriseKnowledgeFile(filePath: string): boolean {
  return ENTERPRISE_KNOWLEDGE_FILE_EXTENSIONS.includes(extname(filePath).toLowerCase() as EnterpriseKnowledgeFileExtension);
}
