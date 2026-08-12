import { describe, expect, it } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { buildBackendRuntimeSignature, filterAttachmentsForModelInput } from './runtime-config'

const baseCompat: LlmConnection = {
  slug: 'local',
  name: 'Local',
  providerType: 'pi_compat',
  authType: 'none',
  createdAt: 1,
  baseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: 'gemma',
  piAuthProvider: 'openai',
  customEndpoint: { api: 'openai-completions', supportsImages: true },
  models: [{ id: 'gemma', maxTokens: 32_768, supportsImages: true } as never],
}

function sig(connection: LlmConnection) {
  return buildBackendRuntimeSignature({
    connection,
    provider: 'pi',
    authType: 'api_key',
    resolvedModel: 'gemma',
  })
}

const imageAttachment: FileAttachment = {
  type: 'image',
  path: '/tmp/image.png',
  name: 'image.png',
  mimeType: 'image/png',
  size: 123,
  base64: 'abc',
}

const textAttachment: FileAttachment = {
  type: 'text',
  path: '/tmp/note.txt',
  name: 'note.txt',
  mimeType: 'text/plain',
  size: 12,
  text: 'hello',
}

describe('buildBackendRuntimeSignature', () => {
  it('changes when a custom endpoint model image override changes', () => {
    const enabled = sig(baseCompat)
    const disabled = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: false } as never],
    })

    expect(disabled).not.toBe(enabled)
  })

  it('changes when a custom endpoint model output limit changes', () => {
    const base = sig(baseCompat)
    const changed = sig({
      ...baseCompat,
      models: [{ id: 'gemma', maxTokens: 65_536, supportsImages: true } as never],
    })

    expect(changed).not.toBe(base)
  })

  it('ignores non-runtime metadata such as lastUsedAt', () => {
    expect(sig({ ...baseCompat, lastUsedAt: 1 })).toBe(sig({ ...baseCompat, lastUsedAt: 2 }))
  })
})

describe('filterAttachmentsForModelInput', () => {
  it('omits images for pi_compat text-only models while preserving other attachments', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment, textAttachment],
      { ...baseCompat, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages.map(a => a.name)).toEqual(['image.png'])
    expect(result.attachments?.map(a => a.name)).toEqual(['note.txt'])
  })

  it('keeps images when the per-model override enables images', () => {
    const result = filterAttachmentsForModelInput([imageAttachment], baseCompat, 'gemma')

    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })

  it('treats explicit supportsImages=false as overriding endpoint-level true', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, customEndpoint: { api: 'openai-completions', supportsImages: true }, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments).toBeUndefined()
  })

  it('omits images for native Pi DeepSeek even when vision bridge is enabled', () => {
    const deepseek: LlmConnection = {
      slug: 'deepseek',
      name: 'DeepSeek',
      providerType: 'pi',
      authType: 'api_key',
      createdAt: 1,
      piAuthProvider: 'deepseek',
      visionBridge: { enabled: true, model: 'glm-4.6v-flash' },
    }
    const result = filterAttachmentsForModelInput([imageAttachment, textAttachment], deepseek, 'pi/deepseek-v4-flash')
    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments?.map(a => a.name)).toEqual(['note.txt'])
  })

  it('keeps images for native Pi OpenAI', () => {
    const openai: LlmConnection = {
      slug: 'openai',
      name: 'OpenAI',
      providerType: 'pi',
      authType: 'api_key',
      createdAt: 1,
      piAuthProvider: 'openai',
    }
    const result = filterAttachmentsForModelInput([imageAttachment], openai, 'pi/gpt-5.5')
    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })
})
