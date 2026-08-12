import { describe, expect, it } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
import type { BackendConfig } from '../backend/types.ts'

function createConfig(): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-test',
      name: 'Test Workspace',
      rootPath: '/tmp/craft-agent-test',
    } as any,
    session: {
      id: 'session-test',
      workspaceRootPath: '/tmp/craft-agent-test',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  }
}

describe('PiAgent subprocess error handling', () => {
  it('maps raw HTML subprocess errors to typed proxy_error events', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].type).toBe('typed_error')
    expect(enqueued[0].error.code).toBe('proxy_error')
    expect(enqueued[0].error.message.toLowerCase()).not.toContain('<html')

    agent.destroy()
  })

  it('does not enqueue chat errors for mini_completion_error messages', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    let rejectedMessage = ''
    ;(agent as any).pendingMiniCompletions.set('mini-1', {
      resolve: () => {},
      reject: (error: Error) => {
        rejectedMessage = error.message
      },
    })

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      code: 'mini_completion_error',
      message: '<html><head><title>400 Bad Request</title></head><body><center><h1>400 Bad Request</h1></center><hr><center>cloudflare</center></body></html>',
    }))

    expect(enqueued).toHaveLength(0)
    expect((agent as any).pendingMiniCompletions.size).toBe(0)
    expect(rejectedMessage).toContain('400 Bad Request')

    agent.destroy()
  })

  it('suppresses only identical consecutive subprocess errors', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 4; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    expect(enqueued).toHaveLength(3)
    expect(enqueued.every((event) => event.type === 'error' || event.type === 'typed_error')).toBe(true)

    agent.destroy()
  })

  it('resets repeated subprocess error suppression after non-error traffic', () => {
    const agent = new PiAgent(createConfig())

    const enqueued: any[] = []
    ;(agent as any).eventQueue.enqueue = (event: any) => {
      enqueued.push(event)
    }

    for (let i = 0; i < 3; i++) {
      ;(agent as any).handleLine(JSON.stringify({
        type: 'error',
        message: 'EFAULT: broken pipe',
      }))
    }

    ;(agent as any).handleLine(JSON.stringify({
      type: 'event',
      event: { type: 'agent_message_delta', delta: 'ok' },
    }))

    ;(agent as any).handleLine(JSON.stringify({
      type: 'error',
      message: 'EFAULT: broken pipe',
    }))

    expect(enqueued.filter((event) => event.type === 'error' || event.type === 'typed_error')).toHaveLength(4)

    agent.destroy()
  })

  it('treats exitCode/killed/unwritable stdin as unhealthy and clears on send failure', () => {
    const agent = new PiAgent(createConfig())
    const writes: string[] = []
    let writeErrorListener: ((error: Error) => void) | undefined
    const stdin = {
      destroyed: false,
      writable: true,
      write: (_chunk: string, cb?: (error?: Error | null) => void) => {
        writes.push(_chunk)
        cb?.(new Error('write EPIPE'))
        return true
      },
      on: (event: string, listener: (error: Error) => void) => {
        if (event === 'error') writeErrorListener = listener
      },
    }
    ;(agent as any).subprocess = {
      killed: false,
      exitCode: null,
      signalCode: null,
      stdin,
      kill: () => {},
    }
    ;(agent as any).subprocessReady = Promise.resolve()

    expect((agent as any).isSubprocessHealthy()).toBe(true)
    ;(agent as any).send({ type: 'ping' })
    expect(writes).toHaveLength(1)
    expect((agent as any).subprocess).toBeNull()

    ;(agent as any).subprocess = {
      killed: false,
      exitCode: 1,
      signalCode: null,
      stdin: { destroyed: false, writable: true },
    }
    expect((agent as any).isSubprocessHealthy()).toBe(false)

    agent.destroy()
  })
})
