import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Risk, Change, and Decision project skill', () => {
  test('loads with notice, approval, evidence, and private-store guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-risk-change', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the risk, change, and decision system of record.');
    expect(skill!.content).toContain('contractual notices');
    expect(skill!.content).toContain('claims');
    expect(skill!.content).toContain('direct implementation evidence');
    expect(skill!.content).toContain('cannot become an implementation fact or approved change');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Pause for user confirmation');
    expect(skill!.content).toContain('Do not spawn nested agents.');
  });
});
