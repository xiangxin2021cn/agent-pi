import { getKnowledgeBaseFolder, isKnowledgeBaseSource } from '@craft-agent/shared/sources/knowledge-base'
import type { LoadedSource } from '../../../shared/types'

export interface KnowledgeBaseSourceSection {
  folder: string
  sources: LoadedSource[]
}

export function buildKnowledgeBaseSourceSections(sources: LoadedSource[]): KnowledgeBaseSourceSection[] {
  const byFolder = new Map<string, LoadedSource[]>()

  for (const source of sources) {
    if (!isKnowledgeBaseSource(source)) continue
    const folder = getKnowledgeBaseFolder(source) ?? 'General'
    const folderSources = byFolder.get(folder) ?? []
    folderSources.push(source)
    byFolder.set(folder, folderSources)
  }

  return [...byFolder.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, folderSources]) => ({
      folder,
      sources: [...folderSources].sort((left, right) => left.config.name.localeCompare(right.config.name)),
    }))
}
