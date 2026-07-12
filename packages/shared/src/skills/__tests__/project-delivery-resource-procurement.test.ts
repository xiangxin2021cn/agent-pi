import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Resource and Procurement project skill', () => {
  test('loads with direct-input and procurement-timing guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-resource-procurement', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the resource and procurement system of record.');
    expect(skill!.content).toContain('direct implementation evidence');
    expect(skill!.content).toContain('required-on-site');
    expect(skill!.content).toContain('capacity');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('cannot become a confirmed resource or commitment');
    expect(skill!.content).toContain('Pause for user confirmation');
    expect(skill!.content).toContain('Do not spawn nested agents.');
  });
});
