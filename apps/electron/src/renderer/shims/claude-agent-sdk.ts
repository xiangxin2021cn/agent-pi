const rendererSdkError =
  '@anthropic-ai/claude-agent-sdk is not available in the Electron renderer. Route SDK work through the main process or server-core.'

export class AbortError extends Error {
  constructor(message = rendererSdkError) {
    super(message)
    this.name = 'AbortError'
  }
}

export async function* query(): AsyncGenerator<never, never, unknown> {
  throw new Error(rendererSdkError)
}

export function createSdkMcpServer(): never {
  throw new Error(rendererSdkError)
}

export function tool(definition: unknown): unknown {
  return definition
}
