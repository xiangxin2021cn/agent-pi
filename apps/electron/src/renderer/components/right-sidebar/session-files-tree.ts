import type { SessionFile } from '../../../shared/types'

export const SESSION_FILES_CHILD_LOAD_TIMEOUT_MS = 20_000

export function normalizeSessionFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function sessionFilePathsEqual(left: string, right: string): boolean {
  const a = normalizeSessionFilePath(left)
  const b = normalizeSessionFilePath(right)
  if (a === b) return true
  const looksWindows = (value: string) => /^[A-Za-z]:/.test(value) || value.includes('\\')
  if (looksWindows(left) || looksWindows(right)) {
    return a.toLowerCase() === b.toLowerCase()
  }
  return false
}

export function setHasSessionFilePath(paths: Set<string>, path: string): boolean {
  if (paths.has(path)) return true
  for (const item of paths) {
    if (sessionFilePathsEqual(item, path)) return true
  }
  return false
}

export function treeHasDirectory(files: SessionFile[], directoryPath: string): boolean {
  for (const file of files) {
    if (file.type === 'directory' && sessionFilePathsEqual(file.path, directoryPath)) return true
    if (file.children?.length && treeHasDirectory(file.children, directoryPath)) return true
  }
  return false
}

export function replaceDirectoryChildren(
  files: SessionFile[],
  directoryPath: string,
  children: SessionFile[],
): SessionFile[] {
  return files.map((file) => {
    if (file.type === 'directory' && sessionFilePathsEqual(file.path, directoryPath)) {
      return {
        ...file,
        children,
        childrenLoaded: true,
        hasMoreChildren: false,
      }
    }
    if (file.children?.length) {
      return {
        ...file,
        children: replaceDirectoryChildren(file.children, directoryPath, children),
      }
    }
    return file
  })
}

export function directoryNeedsChildLoad(node: SessionFile, expanded: Set<string>): boolean {
  if (node.type !== 'directory') return false
  if (!setHasSessionFilePath(expanded, node.path)) return false
  if (node.childrenLoaded === true) return false
  return true
}

export function collectExpandedUnloadedDirectories(
  files: SessionFile[],
  expanded: Set<string>,
): SessionFile[] {
  const result: SessionFile[] = []
  const visit = (nodes: SessionFile[]) => {
    for (const node of nodes) {
      if (directoryNeedsChildLoad(node, expanded)) {
        result.push(node)
      }
      if (node.children?.length) visit(node.children)
    }
  }
  visit(files)
  return result
}

export async function hydrateExpandedDirectories(
  roots: SessionFile[],
  expanded: Set<string>,
  fetchChildren: (directoryPath: string) => Promise<SessionFile[]>,
  applyChildren: (directoryPath: string, children: SessionFile[]) => void,
): Promise<void> {
  const visit = async (nodes: SessionFile[]) => {
    for (const node of nodes) {
      if (node.type !== 'directory' || !setHasSessionFilePath(expanded, node.path)) continue
      if (node.childrenLoaded === true) {
        if (node.children?.length) await visit(node.children)
        continue
      }
      try {
        const children = await fetchChildren(node.path)
        applyChildren(node.path, children)
        await visit(children)
      } catch (error) {
        console.error('Failed to hydrate expanded directory:', node.path, error)
      }
    }
  }
  await visit(roots)
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
