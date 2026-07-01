import { getContextPressureSignal, type ContextPressureInput } from '@craft-agent/shared/sessions/context-pressure'

type ModelEntry = string | { id: string; contextWindow?: number }

export interface ContextPressureViewModel {
  level: 'warning' | 'high'
  label: string
  detail: string
  sourceCount: number
  estimatedSourceTokens: number
  contextUsagePercent?: number
}

export function getContextPressureViewModel(input: ContextPressureInput): ContextPressureViewModel | undefined {
  const signal = getContextPressureSignal(input)
  if (!signal) return undefined

  return {
    level: signal.level,
    label: 'Context pressure',
    detail: signal.detail,
    sourceCount: signal.sourceCount,
    estimatedSourceTokens: signal.estimatedSourceTokens,
    contextUsagePercent: signal.contextUsagePercent,
  }
}

export function resolveModelContextWindow(input: {
  sessionModel?: string
  connection?: {
    defaultModel?: string
    models?: ModelEntry[]
  }
}): number | undefined {
  const models = input.connection?.models ?? []
  const modelId = input.sessionModel || input.connection?.defaultModel
  if (!modelId) return undefined

  const model = models.find(item => typeof item !== 'string' && item.id === modelId)
  return typeof model !== 'string' ? model?.contextWindow : undefined
}
