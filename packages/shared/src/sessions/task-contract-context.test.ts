import { describe, expect, it } from 'bun:test';
import { formatTaskContractContext } from './task-contract-context.ts';
import type { SessionTaskContract } from './types.ts';

const contract: SessionTaskContract = {
  originalRequest: 'Deeply research the market and produce a cited report.',
  taskType: 'research',
  deliverables: [
    'Produce a structured report.',
    'Include a concise executive summary.',
    'Create a source table.',
    'List implementation recommendations.',
  ],
  mustPreserve: [
    'Explicit requirement: cite primary sources.',
    'Explicit requirement: include cost and latency tradeoffs.',
  ],
  evidenceRequirements: [
    'Cite source URLs for factual claims.',
    'Mark assumptions when evidence is unavailable.',
  ],
  outputFormats: ['MD'],
  acceptanceCriteria: [
    '[deliverable] Complete the user request.',
    '[evidence] Ground key facts in available source material.',
    '[coverage] Cover the requested scope comprehensively.',
    '[format] Produce a structured, readable deliverable.',
  ],
  forbiddenShortcuts: [
    'Do not provide a generic outline instead of the requested report.',
  ],
};

describe('formatTaskContractContext', () => {
  it('formats a bounded execution contract for prompt context', () => {
    const formatted = formatTaskContractContext(contract);

    expect(formatted).toContain('<goal_contract taskType="research">');
    expect(formatted).toContain('Deliverables:');
    expect(formatted).toContain('1. Produce a structured report.');
    expect(formatted).toContain('Must preserve:');
    expect(formatted).toContain('Evidence requirements:');
    expect(formatted).toContain('Acceptance criteria:');
    expect(formatted).toContain('Forbidden shortcuts:');
    expect(formatted).toContain('</goal_contract>');
    expect(formatted).not.toContain('4. List implementation recommendations.');
  });

  it('returns undefined when no contract is available', () => {
    expect(formatTaskContractContext(undefined)).toBeUndefined();
  });
});
