export type CustomEndpointInput = 'text' | 'image'

export const CUSTOM_ENDPOINT_DEFAULT_CONTEXT_WINDOW = 131_072
export const CUSTOM_ENDPOINT_DEFAULT_MAX_TOKENS = 8_192
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000
export const DEEPSEEK_V4_MAX_TOKENS = 384_000
/** Kimi Coding / Moonshot K3 1M catalog values (Pi SDK kimi-coding `k3`). */
export const KIMI_K3_CONTEXT_WINDOW = 1_048_576
export const KIMI_K3_MAX_TOKENS = 131_072
export const KIMI_K3_256K_CONTEXT_WINDOW = 262_144

export interface CustomEndpointModelDefaults {
  supportsImages?: boolean
  maxTokens?: number
}

export interface CustomEndpointModelOverrides {
  contextWindow?: number
  maxTokens?: number
  supportsImages?: boolean
}

export interface CustomEndpointModelEntry extends CustomEndpointModelOverrides {
  id: string
}

export type CustomEndpointModelConfig = string | {
  id: string
  contextWindow?: number
  maxTokens?: number
  supportsImages?: boolean
}

/** Strip bare model IDs (remove pi/ prefix if present). */
export function stripPiPrefix(id: string): string {
  return id.startsWith('pi/') ? id.slice(3) : id
}

/**
 * Normalize a user-configured custom endpoint model for Pi SDK registration.
 *
 * Keep explicit per-model capability overrides intact. In particular,
 * `supportsImages: false` is meaningful because it can override a global
 * endpoint default of `supportsImages: true` for text-only models.
 */
export function normalizeCustomEndpointModelEntry(model: CustomEndpointModelConfig): CustomEndpointModelEntry {
  if (typeof model === 'string') {
    return { id: stripPiPrefix(model) }
  }

  return {
    id: stripPiPrefix(model.id),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
  }
}

function normalizedCapabilityId(id: string): string {
  return stripPiPrefix(id).trim().toLowerCase().replace(/[_\s]+/g, '-')
}

export function getKnownCustomEndpointModelCapabilities(id: string): Pick<CustomEndpointModelOverrides, 'contextWindow' | 'maxTokens'> {
  const normalized = normalizedCapabilityId(id)
  const bareId = normalized.includes('/') ? normalized.split('/').at(-1)! : normalized

  if (/^deepseek-v4(?:-(?:pro|flash))?$/.test(bareId) || bareId === 'deepseek-chat' || bareId === 'deepseek-reasoner') {
    return {
      contextWindow: DEEPSEEK_V4_CONTEXT_WINDOW,
      maxTokens: DEEPSEEK_V4_MAX_TOKENS,
    }
  }

  // Kimi K3 1M — Coding API id `k3` and Moonshot id `kimi-k3`.
  if (bareId === 'k3' || bareId === 'kimi-k3' || bareId === 'kimi-k3-preview') {
    return {
      contextWindow: KIMI_K3_CONTEXT_WINDOW,
      maxTokens: KIMI_K3_MAX_TOKENS,
    }
  }
  if (bareId === 'k3-256k' || bareId === 'kimi-k3-256k') {
    return {
      contextWindow: KIMI_K3_256K_CONTEXT_WINDOW,
      maxTokens: KIMI_K3_MAX_TOKENS,
    }
  }

  return {}
}

/**
 * Build a synthetic model definition for a custom endpoint.
 * Uses reasonable defaults for context window and max tokens since we can't
 * query the endpoint for its actual capabilities. Image support must be
 * explicitly enabled either at the connection level or per-model.
 */
export function buildCustomEndpointModelDef(
  id: string,
  defaults?: CustomEndpointModelDefaults,
  overrides?: CustomEndpointModelOverrides,
) {
  const supportsImages = overrides?.supportsImages ?? defaults?.supportsImages ?? false
  const input: CustomEndpointInput[] = supportsImages ? ['text', 'image'] : ['text']
  const knownCapabilities = getKnownCustomEndpointModelCapabilities(id)

  return {
    id,
    name: id,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: overrides?.contextWindow ?? knownCapabilities.contextWindow ?? CUSTOM_ENDPOINT_DEFAULT_CONTEXT_WINDOW,
    maxTokens: overrides?.maxTokens ?? defaults?.maxTokens ?? knownCapabilities.maxTokens ?? CUSTOM_ENDPOINT_DEFAULT_MAX_TOKENS,
  }
}
