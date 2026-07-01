import { describe, expect, it } from 'bun:test'
import { getContextPressureViewModel, resolveModelContextWindow } from './context-pressure-view-model'

describe('context pressure view model', () => {
  it('does not warn for small source sets with large context windows', () => {
    const item = getContextPressureViewModel({
      enabledSourceCount: 2,
      contextWindow: 200_000,
      inputTokens: 12_000,
    })

    expect(item).toBeUndefined()
  })

  it('warns when many enabled sources add likely tool-schema pressure', () => {
    const item = getContextPressureViewModel({
      enabledSourceCount: 12,
      contextWindow: 64_000,
      inputTokens: 8_000,
    })

    expect(item).toMatchObject({
      level: 'warning',
      sourceCount: 12,
    })
    expect(item?.label).toBe('Context pressure')
    expect(item?.detail).toContain('12 sources')
  })

  it('marks pressure high when context usage is already near the model limit', () => {
    const item = getContextPressureViewModel({
      enabledSourceCount: 4,
      contextWindow: 32_000,
      inputTokens: 27_000,
    })

    expect(item).toMatchObject({
      level: 'high',
      contextUsagePercent: 84,
    })
    expect(item?.detail).toContain('84%')
  })

  it('resolves context window from the active connection model', () => {
    const contextWindow = resolveModelContextWindow({
      sessionModel: 'fast-model',
      connection: {
        defaultModel: 'balanced-model',
        models: [
          'legacy-model',
          { id: 'fast-model', contextWindow: 64_000 },
          { id: 'balanced-model', contextWindow: 200_000 },
        ],
      },
    })

    expect(contextWindow).toBe(64_000)
  })
})
