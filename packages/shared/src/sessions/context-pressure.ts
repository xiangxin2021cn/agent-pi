export interface ContextPressureInput {
  enabledSourceCount: number;
  contextWindow?: number;
  inputTokens?: number;
}

export interface ContextPressureSignal {
  level: 'warning' | 'high';
  label: 'context_pressure';
  detail: string;
  sourceCount: number;
  estimatedSourceTokens: number;
  contextUsagePercent?: number;
}

export function getContextPressureSignal(input: ContextPressureInput): ContextPressureSignal | undefined {
  const sourceCount = Math.max(0, input.enabledSourceCount);
  const estimatedSourceTokens = estimateSourcePressureTokens(sourceCount);
  const contextWindow = input.contextWindow && input.contextWindow > 0 ? input.contextWindow : undefined;
  const inputTokens = input.inputTokens && input.inputTokens > 0 ? input.inputTokens : undefined;
  const sourcePressureRatio = contextWindow ? estimatedSourceTokens / contextWindow : 0;
  const contextUsagePercent = contextWindow && inputTokens
    ? Math.min(100, Math.round((inputTokens / contextWindow) * 100))
    : undefined;

  const high = (contextUsagePercent !== undefined && contextUsagePercent >= 80)
    || (contextWindow !== undefined && sourcePressureRatio >= 0.35 && sourceCount >= 6);
  const warning = high
    || sourceCount >= 10
    || (contextWindow !== undefined && sourcePressureRatio >= 0.18 && sourceCount >= 4)
    || (contextUsagePercent !== undefined && contextUsagePercent >= 70);

  if (!warning) return undefined;

  return {
    level: high ? 'high' : 'warning',
    label: 'context_pressure',
    detail: buildContextPressureDetail({
      sourceCount,
      estimatedSourceTokens,
      contextUsagePercent,
    }),
    sourceCount,
    estimatedSourceTokens,
    contextUsagePercent,
  };
}

function estimateSourcePressureTokens(sourceCount: number): number {
  if (sourceCount <= 0) return 0;
  return 4_000 + sourceCount * 1_200;
}

function buildContextPressureDetail(input: {
  sourceCount: number;
  estimatedSourceTokens: number;
  contextUsagePercent?: number;
}): string {
  const parts = [
    `${input.sourceCount} sources`,
    `~${formatTokenCount(input.estimatedSourceTokens)} source/tool tokens`,
  ];
  if (input.contextUsagePercent !== undefined) {
    parts.push(`${input.contextUsagePercent}% context used`);
  }
  return parts.join(' · ');
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}
