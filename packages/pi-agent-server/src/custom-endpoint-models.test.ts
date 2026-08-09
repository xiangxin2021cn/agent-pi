import { describe, expect, it } from 'bun:test'
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
} from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model IDs', () => {
    expect(stripPiPrefix('pi/my-model')).toBe('my-model')
    expect(normalizeCustomEndpointModelEntry('pi/my-model')).toEqual({ id: 'my-model' })
  })

  it('preserves per-model image support when enabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves explicit per-model image support when disabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/text-only-model',
      supportsImages: false,
    })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      contextWindow: 262_144,
      maxTokens: 32_768,
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      contextWindow: 262_144,
      maxTokens: 32_768,
      supportsImages: true,
    })
  })
})

describe('buildCustomEndpointModelDef', () => {
  it('defaults custom endpoint models to text-only input', () => {
    const model = buildCustomEndpointModelDef('my-model')
    expect(model.input).toEqual(['text'])
  })

  it('enables image input when the connection explicitly opts in', () => {
    const model = buildCustomEndpointModelDef('vision-model', { supportsImages: true })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets per-model overrides disable image input even when the connection default is enabled', () => {
    const model = buildCustomEndpointModelDef('text-only-model', { supportsImages: true }, { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })

  it('lets per-model overrides enable image input and custom context window', () => {
    const model = buildCustomEndpointModelDef('vision-model', undefined, { supportsImages: true, contextWindow: 262_144, maxTokens: 32_768 })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(262_144)
    expect(model.maxTokens).toBe(32_768)
  })

  it('uses DeepSeek V4 long-context defaults for custom endpoints', () => {
    const model = buildCustomEndpointModelDef('deepseek-v4-pro')
    expect(model.contextWindow).toBe(1_000_000)
    expect(model.maxTokens).toBe(384_000)
  })

  it('uses DeepSeek V4 defaults when the model is namespaced', () => {
    const model = buildCustomEndpointModelDef('deepseek/deepseek-v4-flash')
    expect(model.contextWindow).toBe(1_000_000)
    expect(model.maxTokens).toBe(384_000)
  })

  it('uses DeepSeek V4 defaults for official legacy compatibility names', () => {
    const chat = buildCustomEndpointModelDef('deepseek-chat')
    const reasoner = buildCustomEndpointModelDef('deepseek-reasoner')

    expect(chat.contextWindow).toBe(1_000_000)
    expect(chat.maxTokens).toBe(384_000)
    expect(reasoner.contextWindow).toBe(1_000_000)
    expect(reasoner.maxTokens).toBe(384_000)
  })

  it('uses Kimi K3 1M defaults for coding and moonshot ids', () => {
    const coding = buildCustomEndpointModelDef('k3')
    const moonshot = buildCustomEndpointModelDef('kimi-k3')
    const namespaced = buildCustomEndpointModelDef('moonshotai/kimi-k3')

    expect(coding.contextWindow).toBe(1_048_576)
    expect(coding.maxTokens).toBe(131_072)
    expect(moonshot.contextWindow).toBe(1_048_576)
    expect(moonshot.maxTokens).toBe(131_072)
    expect(namespaced.contextWindow).toBe(1_048_576)
  })

  it('uses Kimi K3-256K defaults for the smaller coding variant', () => {
    const model = buildCustomEndpointModelDef('k3-256k')
    expect(model.contextWindow).toBe(262_144)
    expect(model.maxTokens).toBe(131_072)
  })
})
