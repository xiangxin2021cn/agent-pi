import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Resource Investment Intelligence core skill', () => {
  test('loads with plugin-isolation and knowledge-snapshot guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'resource-investment-intelligence-core', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `investment_workspace` as the investment system of record.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Do not read Tender Workspace or Delivery Workspace private files.');
    expect(skill!.content).toContain('immutable enterprise knowledge snapshot');
    expect(skill!.content).toContain('cannot be the sole basis for an approved assumption');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
