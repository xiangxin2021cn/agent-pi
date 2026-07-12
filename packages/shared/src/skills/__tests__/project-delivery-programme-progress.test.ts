import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Programme and Progress project skill', () => {
  test('loads with data-date, direct-progress, and source-boundary guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-programme-progress', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the programme and progress system of record.');
    expect(skill!.content).toContain('approved local schedule baseline');
    expect(skill!.content).toContain('data date');
    expect(skill!.content).toContain('direct progress evidence');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Do not use a tender programme as the live implementation baseline.');
    expect(skill!.content).toContain('Do not spawn nested agents.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
