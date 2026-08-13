import { describe, expect, it } from 'bun:test'
import type { SessionFile } from '../../../../shared/types'
import {
  collectExpandedUnloadedDirectories,
  hydrateExpandedDirectories,
  replaceDirectoryChildren,
  sessionFilePathsEqual,
  withTimeout,
} from '../session-files-tree'

function dir(path: string, extras: Partial<SessionFile> = {}): SessionFile {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    type: 'directory',
    children: [],
    childrenLoaded: false,
    hasMoreChildren: true,
    source: 'official-output',
    ...extras,
  }
}

function file(path: string): SessionFile {
  return {
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    type: 'file',
    size: 12,
    source: 'official-output',
  }
}

describe('session-files-tree', () => {
  it('treats Windows path slash and drive-letter case as the same folder', () => {
    expect(sessionFilePathsEqual(
      'C:\\Users\\xiang\\Agent Pi Outputs\\session\\orchestration\\briefs',
      'C:/Users/xiang/Agent Pi Outputs/session/orchestration/briefs',
    )).toBe(true)
    expect(sessionFilePathsEqual(
      'C:\\Users\\xiang\\briefs',
      'c:\\Users\\xiang\\briefs',
    )).toBe(true)
  })

  it('replaces nested official-output children even when the path separators differ', () => {
    const tree = [
      dir('C:\\proj\\Agent Pi Outputs\\s1', {
        childrenLoaded: true,
        hasMoreChildren: false,
        children: [
          dir('C:\\proj\\Agent Pi Outputs\\s1\\orchestration', {
            childrenLoaded: true,
            hasMoreChildren: false,
            children: [
              dir('C:\\proj\\Agent Pi Outputs\\s1\\orchestration\\briefs'),
              dir('C:\\proj\\Agent Pi Outputs\\s1\\orchestration\\reports'),
            ],
          }),
        ],
      }),
    ]

    const next = replaceDirectoryChildren(
      tree,
      'C:/proj/Agent Pi Outputs/s1/orchestration/briefs',
      [file('C:/proj/Agent Pi Outputs/s1/orchestration/briefs/pricing-agent-1.md')],
    )
    const briefs = next[0]?.children?.[0]?.children?.find((child) => child.name === 'briefs')
    expect(briefs?.childrenLoaded).toBe(true)
    expect(briefs?.children?.map((child) => child.name)).toEqual(['pricing-agent-1.md'])
  })

  it('collects expanded placeholder folders that still need a child fetch', () => {
    const briefs = dir('C:\\proj\\out\\orchestration\\briefs')
    const reports = dir('C:\\proj\\out\\orchestration\\reports')
    const orchestration = dir('C:\\proj\\out\\orchestration', {
      childrenLoaded: true,
      hasMoreChildren: false,
      children: [briefs, reports],
    })
    const official = dir('C:\\proj\\out', {
      name: 'Official Outputs',
      childrenLoaded: true,
      hasMoreChildren: false,
      children: [orchestration],
    })

    const expanded = new Set([
      official.path,
      orchestration.path,
      briefs.path,
      reports.path,
    ])
    const unloaded = collectExpandedUnloadedDirectories([official], expanded)
    expect(unloaded.map((node) => node.name).sort()).toEqual(['briefs', 'reports'])
  })

  it('hydrates expanded placeholders without refetching already loaded parents', async () => {
    const briefs = dir('/tmp/out/orchestration/briefs')
    const orchestration = dir('/tmp/out/orchestration', {
      childrenLoaded: true,
      hasMoreChildren: false,
      children: [briefs],
    })
    const fetched: string[] = []
    await hydrateExpandedDirectories(
      [orchestration],
      new Set([orchestration.path, briefs.path]),
      async (directoryPath) => {
        fetched.push(directoryPath)
        return [file(`${directoryPath}/pricing-agent-1.md`)]
      },
      () => {},
    )
    expect(fetched).toEqual([briefs.path])
  })

  it('times out a hung folder fetch so the loading pill can clear', async () => {
    await expect(withTimeout(
      new Promise(() => {}),
      20,
      'Timed out loading folder contents',
    )).rejects.toThrow('Timed out loading folder contents')
  })
})
