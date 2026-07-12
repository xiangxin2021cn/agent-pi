import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Cash Flow project skill', () => {
  test('loads with cost-versus-cash and exact-reconciliation guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-cashflow', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the cash-flow system of record.');
    expect(skill!.content).toContain('Do not treat cost recognition as cash payment.');
    expect(skill!.content).toContain('exact decimal strings');
    expect(skill!.content).toContain('planned outflow');
    expect(skill!.content).toContain('estimate-at-completion');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Pause for user confirmation');
    expect(skill!.content).toContain('Do not spawn nested agents.');
  });
});
