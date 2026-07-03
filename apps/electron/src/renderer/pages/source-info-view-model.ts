import type { LoadedSource } from '../../shared/types'

export interface SourceInfoRow {
  labelKey: string
  defaultLabel: string
  value: string
}

export function buildKnowledgeBaseInfoRows(source: LoadedSource): SourceInfoRow[] {
  const metadata = source.config.metadata
  if (!metadata || metadata.category !== 'knowledge_base') return []

  return [
    row('sourceInfo.knowledgeBaseCollection', 'Collection', metadata.collectionId),
    row('sourceInfo.knowledgeBaseCategory', 'Category', metadata.knowledgeCategory),
    row('sourceInfo.knowledgeBaseFolder', 'Folder', metadata.knowledgeFolder),
    row('sourceInfo.knowledgeBaseTags', 'Tags', formatTags(metadata.tags)),
    row('sourceInfo.knowledgeBaseSourceFile', 'Source file', metadata.sourceFilePath),
    row('sourceInfo.knowledgeBaseScope', 'Scope', metadata.scope),
    row('sourceInfo.knowledgeBaseSourceKind', 'Source kind', metadata.sourceKind),
    row('sourceInfo.knowledgeBaseFileExtension', 'File extension', metadata.fileExtension),
    row('sourceInfo.knowledgeBaseOwner', 'Owner', metadata.owner),
  ].filter((item): item is SourceInfoRow => item !== null)
}

function row(labelKey: string, defaultLabel: string, value: unknown): SourceInfoRow | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return { labelKey, defaultLabel, value: value.trim() }
}

function formatTags(value: unknown): string | null {
  if (Array.isArray(value)) {
    const tags = value
      .map(tag => typeof tag === 'string' ? tag.trim() : '')
      .filter(Boolean)
    return tags.length > 0 ? tags.join(', ') : null
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
