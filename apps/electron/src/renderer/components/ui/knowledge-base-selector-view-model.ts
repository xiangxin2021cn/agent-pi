import { getKnowledgeBaseFolder, isKnowledgeBaseSource } from '@craft-agent/shared/sources/knowledge-base'
import type { LoadedSource } from '../../../shared/types'

export interface KnowledgeBaseSelectorSection {
  folder: string
  sources: LoadedSource[]
}

export function buildKnowledgeBaseSelectorSections(sources: LoadedSource[]): KnowledgeBaseSelectorSection[] {
  const byFolder = new Map<string, LoadedSource[]>()

  for (const source of sources) {
    if (!isKnowledgeBaseSource(source)) continue
    const folder = getKnowledgeBaseFolder(source) ?? 'General'
    const items = byFolder.get(folder) ?? []
    items.push(source)
    byFolder.set(folder, items)
  }

  return [...byFolder.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, items]) => ({
      folder,
      sources: [...items].sort((left, right) => left.config.name.localeCompare(right.config.name)),
    }))
}

export function setKnowledgeBaseSelection(selectedSlugs: string[], knowledgeBaseSlugs: string[], selected: boolean): string[] {
  const knowledgeBaseSet = new Set(knowledgeBaseSlugs)
  if (!selected) {
    return selectedSlugs.filter(slug => !knowledgeBaseSet.has(slug))
  }

  const next = [...selectedSlugs]
  const current = new Set(next)
  for (const slug of knowledgeBaseSlugs) {
    if (!current.has(slug)) {
      current.add(slug)
      next.push(slug)
    }
  }
  return next
}

export function toggleKnowledgeBaseSlug(selectedSlugs: string[], slug: string): string[] {
  return selectedSlugs.includes(slug)
    ? selectedSlugs.filter(currentSlug => currentSlug !== slug)
    : [...selectedSlugs, slug]
}
