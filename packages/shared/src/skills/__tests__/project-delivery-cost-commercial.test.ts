import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Cost and Commercial project skill', () => {
  test('loads with exact arithmetic, local-budget, and evidence guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-cost-commercial', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the cost and commercial system of record.');
    expect(skill!.content).toContain('exact decimal strings');
    expect(skill!.content).toContain('approved local budget baseline');
    expect(skill!.content).toContain('actual cost');
    expect(skill!.content).toContain('accrual');
    expect(skill!.content).toContain('estimate-at-completion');
    expect(skill!.content).toContain('cannot become an approved budget or posted cost');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
