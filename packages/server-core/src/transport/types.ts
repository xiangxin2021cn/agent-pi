/**
 * Transport-layer interfaces for the WS-based RPC.
 */

import type { PushTarget } from '@craft-agent/shared/protocol'

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
}

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

export interface InvokeOptions {
  /**
   * Client-side request timeout in ms.
   * Use 0 only for user-driven operations, such as native file/folder pickers,
   * that should wait until the user chooses or cancels.
   */
  timeoutMs?: number
}

export interface InvokeClientOptions {
  /**
   * Server-side timeout for client capability requests.
   * Use 0 for user-driven native dialogs that should wait until the user chooses
   * or cancels. Other calls should keep the default timeout.
   */
  timeoutMs?: number
}

export interface RpcServer {
  handle(channel: string, handler: HandlerFn): void
  push(channel: string, target: PushTarget, ...args: any[]): void
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  invokeClientWithOptions?(clientId: string, channel: string, options: InvokeClientOptions, ...args: any[]): Promise<any>
  updateClientWorkspace?(clientId: string, workspaceId: string): void

  /** Whether a connected client advertised the given capability on handshake. */
  hasClientCapability(clientId: string, capability: string): boolean

  /** Connected clients (optionally narrowed by workspaceId) that advertised the capability. */
  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[]
}

export interface RpcClient {
  invoke(channel: string, ...args: any[]): Promise<any>
  invokeWithOptions?(channel: string, options: InvokeOptions, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
