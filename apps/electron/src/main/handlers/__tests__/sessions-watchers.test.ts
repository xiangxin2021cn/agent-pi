import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '../../../shared/types'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

type HandlerFn = (ctx: { clientId: string }, ...args: any[]) => Promise<any> | any

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessions file watchers', () => {
  const handlers = new Map<string, HandlerFn>()
  const pushed: Array<{ channel: string; target: any; args: any[] }> = []

  let tempRoot = ''
  let sessionDirA = ''
  let sessionDirB = ''
  let sessionWorkingDirectories: Record<string, string | undefined> = {}

  beforeEach(() => {
    handlers.clear()
    pushed.length = 0
    sessionWorkingDirectories = {}

    tempRoot = mkdtempSync(join(tmpdir(), 'craft-session-watchers-'))
    sessionDirA = join(tempRoot, 'session-a')
    sessionDirB = join(tempRoot, 'session-b')
    mkdirSync(sessionDirA, { recursive: true })
    mkdirSync(sessionDirB, { recursive: true })

    const server: RpcServer = {
      handle(channel, handler) {
        handlers.set(channel, handler as HandlerFn)
      },
      push(channel, target, ...args) {
        pushed.push({ channel, target, args })
      },
      async invokeClient() {
        return null
      },
      hasClientCapability() { return false },
      findClientsWithCapability() { return [] },
    }

    const deps: HandlerDeps = {
      sessionManager: {
        getSessionPath: (sessionId: string) => {
          if (sessionId === 'session-a') return sessionDirA
          if (sessionId === 'session-b') return sessionDirB
          return null
        },
        getSessionBrowseContext: (sessionId: string) => {
          const workingDirectory = sessionWorkingDirectories[sessionId]
          return workingDirectory ? { workingDirectory } : null
        },
        getSessions: () => [
          { id: 'session-a', workingDirectory: sessionWorkingDirectories['session-a'] },
          { id: 'session-b', workingDirectory: sessionWorkingDirectories['session-b'] },
        ],
      } as unknown as HandlerDeps['sessionManager'],
      platform: {
        appRootPath: '',
        resourcesPath: '',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: true,
        imageProcessor: {
          getMetadata: async () => null,
          process: async () => Buffer.from(''),
        },
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        },
      },
      oauthFlowStore: {
        store: () => {},
        getByState: () => null,
        remove: () => {},
        cleanup: () => {},
        dispose: () => {},
        get size() { return 0 },
      } as unknown as HandlerDeps['oauthFlowStore'],
    }

    registerSessionsHandlers(server, deps)
  })

  afterEach(() => {
    cleanupSessionFileWatchForClient('client-a')
    cleanupSessionFileWatchForClient('client-b')
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('isolates file change notifications per client watcher', async () => {
    const watch = handlers.get(RPC_CHANNELS.sessions.WATCH_FILES)
    const unwatch = handlers.get(RPC_CHANNELS.sessions.UNWATCH_FILES)
    expect(watch).toBeTruthy()
    expect(unwatch).toBeTruthy()

    await watch!({ clientId: 'client-a' }, 'session-a')
    await watch!({ clientId: 'client-b' }, 'session-b')
    await wait(150)

    writeFileSync(join(sessionDirA, 'a.txt'), `a-${Date.now()}`)
    writeFileSync(join(sessionDirB, 'b.txt'), `b-${Date.now()}`)
    await wait(1000)

    const aEvents = pushed.filter((evt) => evt.target?.to === 'client' && evt.target?.clientId === 'client-a')
    const bEvents = pushed.filter((evt) => evt.target?.to === 'client' && evt.target?.clientId === 'client-b')

    expect(aEvents.some((evt) => evt.channel === RPC_CHANNELS.sessions.FILES_CHANGED && evt.args[0] === 'session-a')).toBe(true)
    expect(bEvents.some((evt) => evt.channel === RPC_CHANNELS.sessions.FILES_CHANGED && evt.args[0] === 'session-b')).toBe(true)

    pushed.length = 0
    await unwatch!({ clientId: 'client-a' })

    writeFileSync(join(sessionDirA, 'a.txt'), `a2-${Date.now()}`)
    writeFileSync(join(sessionDirB, 'b.txt'), `b2-${Date.now()}`)
    await wait(1000)

    const aEventsAfter = pushed.filter((evt) => evt.target?.clientId === 'client-a')
    const bEventsAfter = pushed.filter((evt) => evt.target?.clientId === 'client-b')

    expect(aEventsAfter.length).toBe(0)
    expect(bEventsAfter.some((evt) => evt.channel === RPC_CHANNELS.sessions.FILES_CHANGED && evt.args[0] === 'session-b')).toBe(true)
  })

  it('disconnect cleanup removes watcher and prevents further events', async () => {
    const watch = handlers.get(RPC_CHANNELS.sessions.WATCH_FILES)
    expect(watch).toBeTruthy()

    await watch!({ clientId: 'client-a' }, 'session-a')
    await wait(150)

    cleanupSessionFileWatchForClient('client-a')
    pushed.length = 0

    writeFileSync(join(sessionDirA, 'after-cleanup.txt'), `x-${Date.now()}`)
    await wait(1000)

    expect(pushed.length).toBe(0)
  })

  it('loads session files lazily by directory depth', async () => {
    const getFiles = handlers.get(RPC_CHANNELS.sessions.GET_FILES)
    expect(getFiles).toBeTruthy()

    mkdirSync(join(sessionDirA, 'data', 'nested'), { recursive: true })
    writeFileSync(join(sessionDirA, 'root.txt'), 'root')
    writeFileSync(join(sessionDirA, 'data', 'top.md'), 'top')
    writeFileSync(join(sessionDirA, 'data', 'nested', 'deep.md'), 'deep')

    const initial = await getFiles!({ clientId: 'client-a' }, 'session-a', { maxDepth: 1 })
    const data = initial.find((file: any) => file.name === 'data')
    expect(data).toBeTruthy()
    expect(data.type).toBe('directory')
    expect(data.childrenLoaded).toBe(true)
    expect(data.children.some((file: any) => file.name === 'top.md')).toBe(true)
    const nested = data.children.find((file: any) => file.name === 'nested')
    expect(nested).toBeTruthy()
    expect(nested.childrenLoaded).toBe(false)
    expect(nested.hasMoreChildren).toBe(true)
    expect(JSON.stringify(initial)).not.toContain('deep.md')

    const nestedChildren = await getFiles!({ clientId: 'client-a' }, 'session-a', {
      parentPath: join(sessionDirA, 'data', 'nested'),
      maxDepth: 1,
    })
    expect(nestedChildren.map((file: any) => file.name)).toEqual(['deep.md'])
  })

  it('loads official-output children from the working-directory Agent Pi Outputs folder', async () => {
    const getFiles = handlers.get(RPC_CHANNELS.sessions.GET_FILES)
    expect(getFiles).toBeTruthy()

    const workingDirectory = join(tempRoot, 'lesotho-project')
    const outputDir = join(workingDirectory, 'Agent Pi Outputs', 'session-a')
    const briefsDir = join(outputDir, 'orchestration', 'briefs')
    const vendorDir = join(workingDirectory, 'node_modules', 'left-pad')
    mkdirSync(briefsDir, { recursive: true })
    mkdirSync(vendorDir, { recursive: true })
    writeFileSync(join(briefsDir, 'pricing-agent-1.md'), 'ok')
    writeFileSync(join(vendorDir, 'index.js'), 'module.exports = {}')
    sessionWorkingDirectories['session-a'] = workingDirectory

    const initial = await getFiles!({ clientId: 'client-a' }, 'session-a', { maxDepth: 1 })
    const official = initial.find((file: any) => file.source === 'official-output')
    expect(official?.name).toBe('Official Outputs')
    const orchestration = official?.children?.find((file: any) => file.name === 'orchestration')
    const briefs = orchestration?.children?.find((file: any) => file.name === 'briefs')
    expect(briefs?.childrenLoaded).toBe(false)
    expect(JSON.stringify(initial)).not.toContain('pricing-agent-1.md')

    const working = initial.find((file: any) => file.source === 'working-directory')
    expect(working?.childrenLoaded).toBe(false)
    expect(working?.hasMoreChildren).toBe(true)
    expect(JSON.stringify(working ?? {})).not.toContain('left-pad')

    const workingChildren = await getFiles!({ clientId: 'client-a' }, 'session-a', {
      parentPath: workingDirectory,
      maxDepth: 1,
    })
    expect(workingChildren.map((file: any) => file.name)).not.toContain('Agent Pi Outputs')
    const nodeModules = workingChildren.find((file: any) => file.name === 'node_modules')
    expect(nodeModules?.childrenLoaded).toBe(false)
    expect(JSON.stringify(nodeModules ?? {})).not.toContain('left-pad')

    const briefChildren = await getFiles!({ clientId: 'client-a' }, 'session-a', {
      parentPath: briefsDir,
      maxDepth: 1,
    })
    expect(briefChildren.map((file: any) => file.name)).toEqual(['pricing-agent-1.md'])
    expect(briefChildren[0]?.source).toBe('official-output')
  })
})
