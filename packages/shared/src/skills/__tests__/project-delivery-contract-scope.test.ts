import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Contract and Scope project skill', () => {
  test('loads with local baseline and snapshot-evidence guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-contract-scope', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the contract-scope system of record.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Require approved local contract and scope baselines.');
    expect(skill!.content).toContain('A tender or knowledge snapshot may corroborate scope but cannot be its sole evidence.');
    expect(skill!.content).toContain('acceptance criteria');
    expect(skill!.content).toContain('RACI');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
