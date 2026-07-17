import type { SessionMeta } from '@/atoms/sessions'

export function normalizeSessionProjectPath(path?: string): string | null {
  const trimmed = path?.trim()
  if (!trimmed) return null
  return trimmed.replace(/[\\/]+$/, '')
}

export function getSessionProjectGroupKey(item: SessionMeta): string {
  const context = item.businessContext
  if (context) {
    return `project-business-${context.module}-${context.projectId}`
  }

  const normalized = normalizeSessionProjectPath(item.workingDirectory)
  return normalized ? `project-${normalized}` : 'project-none'
}

export function getSessionProjectGroupLabel(item: SessionMeta, fallback: string): string {
  if (item.businessContext) return item.businessContext.projectId

  const path = normalizeSessionProjectPath(item.workingDirectory)
  if (!path) return fallback
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function getSessionProjectGroupDescription(item: SessionMeta, fallback: string): string {
  const path = normalizeSessionProjectPath(item.workingDirectory)
  if (!path) return fallback
  return item.businessContext ? `${item.businessContext.module} · ${path}` : path
}
