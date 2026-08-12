import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { resolveVisionBridgeConfig } from '@craft-agent/shared/config'
import {
  applyVisionBridgeToMessage,
  buildVisionQuestion,
  injectVisionCaptions,
  toImageUrl,
  visionChat,
} from './vision-bridge'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-secret',
    model: 'test-vlm',
    maxTokens: 256,
    timeoutMs: 5_000,
    maxImageBytes: 1024,
    source: 'data:image/png;base64,AAAA',
    question: 'what is this?',
    ...overrides,
  }
}

describe('toImageUrl', () => {
  it('passes http(s) and data URLs through', async () => {
    expect(await toImageUrl('https://a.test/x.png', 10)).toBe('https://a.test/x.png')
    expect(await toImageUrl('data:image/png;base64,AAAA', 10)).toBe('data:image/png;base64,AAAA')
  })

  it('base64-encodes a local file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vision-bridge-'))
    const file = join(dir, 'shot.png')
    writeFileSync(file, PNG_BYTES)
    try {
      expect(await toImageUrl(file, 1024)).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('visionChat', () => {
  it('POSTs the OpenAI-compatible shape and returns string content', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init: init! }
      return okResponse({ choices: [{ message: { content: 'a red panda' } }] })
    }) as unknown as typeof fetch

    const answer = await visionChat({ ...baseRequest(), fetch: fakeFetch })
    expect(answer).toBe('a red panda')
    expect(seen!.url).toBe('https://example.test/v1/chat/completions')
    const headers = seen!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-secret')
    const body = JSON.parse(String(seen!.init.body)) as { model: string; messages: Array<{ content: Array<{ type: string }> }> }
    expect(body.model).toBe('test-vlm')
    expect(body.messages[0]!.content.map(part => part.type)).toEqual(['image_url', 'text'])
  })

  it('strips <think> blocks from thinking VLMs', async () => {
    const fakeFetch = (async () => okResponse({
      choices: [{ message: { content: '<think>hmm</think>\ncherry blossom case' } }],
    })) as unknown as typeof fetch
    expect(await visionChat({ ...baseRequest(), fetch: fakeFetch })).toBe('cherry blossom case')
  })

  it('redacts the API key in error messages', async () => {
    const fakeFetch = (async () => new Response('sk-secret leaked', { status: 401 })) as unknown as typeof fetch
    await expect(visionChat({ ...baseRequest(), fetch: fakeFetch })).rejects.toThrow(/returned 401: \*\*\* leaked/)
  })
})

describe('injectVisionCaptions', () => {
  it('appends a single image block', () => {
    const result = injectVisionCaptions('look at this', [{ name: 'a.png', text: 'a cat' }])
    expect(result).toContain('look at this')
    expect(result).toContain('<attached-image name="a.png">')
    expect(result).toContain('a cat')
    expect(result).toContain('treat it as if you saw the image yourself')
  })
})

describe('buildVisionQuestion', () => {
  it('includes the user message and filename', () => {
    const q = buildVisionQuestion('what error is this?', 'shot.png', 0, 1)
    expect(q).toContain('what error is this?')
    expect(q).toContain('shot.png')
  })
})

describe('applyVisionBridgeToMessage', () => {
  const image: FileAttachment = {
    type: 'image',
    path: 'pasted-image-1.png',
    name: 'error.png',
    mimeType: 'image/png',
    size: 4,
    base64: 'AAAA',
  }

  it('injects VLM text and does not require a tool call', async () => {
    const fakeFetch = (async () => okResponse({
      choices: [{ message: { content: 'TypeError at line 12' } }],
    })) as unknown as typeof fetch
    const result = await applyVisionBridgeToMessage({
      message: 'what is this screenshot?',
      images: [image],
      config: resolveVisionBridgeConfig({ enabled: true, baseUrl: 'https://example.test/v1', model: 'vlm' }),
      apiKey: 'sk-vision',
      fetch: fakeFetch,
    })
    expect(result).toContain('what is this screenshot?')
    expect(result).toContain('TypeError at line 12')
    expect(result).toContain('error.png')
  })

  it('falls back to the next model on 429', async () => {
    const models: string[] = []
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      models.push(body.model)
      if (body.model === 'primary') {
        return new Response('busy', { status: 429 })
      }
      return okResponse({ choices: [{ message: { content: 'ok from fallback' } }] })
    }) as unknown as typeof fetch

    const result = await applyVisionBridgeToMessage({
      message: 'describe',
      images: [image],
      config: {
        enabled: true,
        baseUrl: 'https://example.test/v1',
        model: 'primary',
        fallbackModels: ['fallback'],
        maxTokens: 256,
        timeoutMs: 5_000,
        maxImageBytes: 1024,
      },
      apiKey: 'sk-vision',
      fetch: fakeFetch,
    })
    expect(models).toEqual(['primary', 'fallback'])
    expect(result).toContain('ok from fallback')
  })

  it('rejects a missing key on non-local endpoints', async () => {
    await expect(applyVisionBridgeToMessage({
      message: 'hi',
      images: [image],
      config: resolveVisionBridgeConfig({ enabled: true }),
      apiKey: '',
    })).rejects.toThrow(/no vision API key/)
  })
})
