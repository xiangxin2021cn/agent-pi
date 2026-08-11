import { atom } from 'jotai'
import type { BusinessModuleId, BusinessProjectRecord } from '@craft-agent/shared/business-projects'

/**
 * Cached business-project lists keyed by `${moduleId}::${workspaceRootPath}`.
 * Lets Overview paint immediately when returning from chat even if
 * businessProjects:list is briefly queued behind a heavy stage status.
 */
export type BusinessProjectsCacheKey = `${BusinessModuleId}::${string}`

export const businessProjectsCacheAtom = atom<Record<string, BusinessProjectRecord[]>>({})

export function businessProjectsCacheKey(
  moduleId: BusinessModuleId,
  workspaceRootPath: string,
): BusinessProjectsCacheKey {
  return `${moduleId}::${workspaceRootPath}`
}

export function findCachedBusinessProject(
  cache: Record<string, BusinessProjectRecord[]>,
  moduleId: BusinessModuleId,
  workspaceRootPath: string,
  projectId: string,
): BusinessProjectRecord | null {
  const projects = cache[businessProjectsCacheKey(moduleId, workspaceRootPath)] ?? []
  return projects.find((entry) => entry.projectId === projectId)
    ?? projects.find((entry) => entry.name === projectId)
    ?? null
}
