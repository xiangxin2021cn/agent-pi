import { describe, expect, it } from 'bun:test';
import { getContextPressureSignal } from './context-pressure.ts';

describe('getContextPressureSignal', () => {
  it('does not warn for a small source set on a large context model', () => {
    const signal = getContextPressureSignal({
      enabledSourceCount: 2,
      contextWindow: 200_000,
      inputTokens: 12_000,
    });

    expect(signal).toBeUndefined();
  });

  it('warns when many enabled sources create likely tool-schema pressure', () => {
    const signal = getContextPressureSignal({
      enabledSourceCount: 12,
      contextWindow: 64_000,
      inputTokens: 8_000,
    });

    expect(signal).toMatchObject({
      level: 'warning',
      sourceCount: 12,
      label: 'context_pressure',
    });
    expect(signal?.detail).toContain('12 sources');
  });

  it('marks pressure high when current input is near the selected model limit', () => {
    const signal = getContextPressureSignal({
      enabledSourceCount: 4,
      contextWindow: 32_000,
      inputTokens: 27_000,
    });

    expect(signal).toMatchObject({
      level: 'high',
      contextUsagePercent: 84,
    });
    expect(signal?.detail).toContain('84% context used');
  });
});
