import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RpcServer } from '../../transport/types.ts'
import { registerBusinessProjectHandlers } from './business-projects.ts'

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push() {},
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerBusinessProjectHandlers(server)
  return handlers
}

const context = { clientId: 'test', workspaceId: 'workspace-test', webContentsId: 1 }

describe('business project RPC', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('creates and lists projects independently by module', async () => {
    root = mkdtempSync(join(tmpdir(), 'business-project-rpc-'))
    const workspaceRootPath = join(root, 'workspace')
    const projectRoot = join(root, 'n3')
    const tenderPath = join(root, 'tender.pdf')
    writeFileSync(tenderPath, 'tender')
    const handlers = harness()

    const created = await handlers.get(RPC_CHANNELS.businessProjects.CREATE)!(context, {
      workspaceRootPath,
      module: 'tender',
      projectId: 'n3',
      name: 'N3 Tender',
      rootPath: projectRoot,
      workflowId: 'tender-main',
      createDirectory: true,
      inputPaths: [tenderPath],
    }) as any
    const listed = await handlers.get(RPC_CHANNELS.businessProjects.LIST)!(context, { workspaceRootPath, module: 'tender' }) as any[]

    expect(created.projectId).toBe('n3')
    expect(listed).toEqual([created])
    const sourceBoundaryPath = join(projectRoot, '.agent-pi', 'business', 'tender', 'n3', 'source-boundary.json')
    expect(existsSync(sourceBoundaryPath)).toBe(true)
    expect(JSON.parse(readFileSync(sourceBoundaryPath, 'utf8')).registeredCount).toBe(1)
  })

  test('updates registered inputs without treating the project root as an input', async () => {
    root = mkdtempSync(join(tmpdir(), 'business-project-rpc-'))
    const workspaceRootPath = join(root, 'workspace')
    const projectRoot = join(root, 'mine')
    const handlers = harness()
    await handlers.get(RPC_CHANNELS.businessProjects.CREATE)!(context, {
      workspaceRootPath,
      module: 'investment',
      projectId: 'mine',
      name: 'Mine',
      rootPath: projectRoot,
      workflowId: 'investment-main',
      createDirectory: true,
    })

    const updated = await handlers.get(RPC_CHANNELS.businessProjects.UPDATE_INPUTS)!(context, {
      workspaceRootPath,
      module: 'investment',
      projectId: 'mine',
      inputPaths: [join(root, 'study.pdf')],
    }) as any

    expect(updated.inputPaths).toEqual([join(root, 'study.pdf')])
    expect(updated.inputPaths).not.toContain(projectRoot)
  })
})
