import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Reporting and Audit project skill', () => {
  test('loads with enabled-pack, explicit-output, and close-approval guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-reporting-audit', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.content).toContain('Use `delivery_capability` as the reporting and audit system of record.');
    expect(skill!.content).toContain('enabled delivery capability');
    expect(skill!.content).toContain('explicit user request');
    expect(skill!.content).toContain('Do not generate PDF by default.');
    expect(skill!.content).toContain('period-close approval');
    expect(skill!.content).toContain('audit history');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
