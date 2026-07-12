import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');

describe('Project Delivery Controls Core project skill', () => {
  test('loads with direct-input and cross-plugin isolation guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, 'project-delivery-controls-core', PROJECT_ROOT);
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Initialize from user-selected, user-owned project inputs.');
    expect(skill!.content).toContain('A Tender Workspace is not required.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `delivery_workspace` as the system of record.');
    expect(skill!.content).toContain('frozen evidence snapshot');
    expect(skill!.content).toContain('Do not read or write Tender Workspace or Investment Workspace private files.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
