import { getKnowledgeBaseFolder, isKnowledgeBaseSource } from '@craft-agent/shared/sources/knowledge-base'
import type { LoadedSource } from '../../../shared/types'

export interface KnowledgeBaseSourceSection {
  folder: string
  label: string
  description?: string
  collapsible: true
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
    .map(([folder, folderSources]) => {
      const segments = folder.split('/').filter(Boolean)
      const label = segments[segments.length - 1] ?? folder
      const description = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined
      return {
        folder,
        label,
        description,
        collapsible: true as const,
        sources: [...folderSources].sort((left, right) => left.config.name.localeCompare(right.config.name)),
      }
    })
}
