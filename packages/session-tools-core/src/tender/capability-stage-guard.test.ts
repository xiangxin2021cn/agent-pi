import { describe, expect, test } from 'bun:test';
import { assertCapabilityWriteAllowed, allowedCapabilitiesForStage } from './capability-stage-guard.ts';

describe('capability stage guard', () => {
  test('document analysis cannot write boq pricing', () => {
    expect(() => assertCapabilityWriteAllowed('tender-document-analysis', 'boq_five_step_pricing'))
      .toThrow(/not allowed during stage "tender-document-analysis"/);
  });

  test('allows document_analysis on analysis stage', () => {
    expect(() => assertCapabilityWriteAllowed('tender-document-analysis', 'document_analysis'))
      .not.toThrow();
  });

  test('legacy planning alias maps to planning allowlist', () => {
    expect(allowedCapabilitiesForStage('planning')).toContain('execution_plan');
    expect(() => assertCapabilityWriteAllowed('planning', 'boq_five_step_pricing'))
      .toThrow(/planning-and-submission/);
  });

  test('missing stageId does not block (runtime / non-tender)', () => {
    expect(() => assertCapabilityWriteAllowed(undefined, 'boq_five_step_pricing')).not.toThrow();
  });

  test('project-setup blocks all capability writes', () => {
    expect(() => assertCapabilityWriteAllowed('project-setup', 'document_analysis'))
      .toThrow(/not allowed/);
  });
});
