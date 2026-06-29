import { resolve } from 'path'

export interface WorkingDirectoryActivitySnapshot {
  messages?: readonly unknown[]
  messageCount?: number
  sdkSessionId?: string
  hasAgent?: boolean
}

export interface WorkingDirectoryLockDecision {
  locked: boolean
  reason?: string
}

function normalizeWorkingDirectoryIdentity(path: string | undefined): string | undefined {
  if (!path) return undefined
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function hasProjectBoundActivity(snapshot: WorkingDirectoryActivitySnapshot): boolean {
  return (
    (snapshot.messages?.length ?? 0) > 0 ||
    (snapshot.messageCount ?? 0) > 0 ||
    !!snapshot.sdkSessionId ||
    !!snapshot.hasAgent
  )
}

export function getWorkingDirectoryLockDecision(
  currentWorkingDirectory: string | undefined,
  nextWorkingDirectory: string,
  snapshot: WorkingDirectoryActivitySnapshot,
): WorkingDirectoryLockDecision {
  const current = normalizeWorkingDirectoryIdentity(currentWorkingDirectory)
  const next = normalizeWorkingDirectoryIdentity(nextWorkingDirectory)

  if (current && next && current === next) {
    return { locked: false }
  }

  if (!hasProjectBoundActivity(snapshot)) {
    return { locked: false }
  }

  return {
    locked: true,
    reason: currentWorkingDirectory
      ? 'This session is already bound to its working directory. Start a new session for another project folder.'
      : 'This session already has conversation history and cannot be attached to a project folder. Start a new session for that folder.',
  }
}
