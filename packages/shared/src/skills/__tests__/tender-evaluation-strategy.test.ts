import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-evaluation-strategy';

describe('Tender Evaluation Strategy project skill', () => {
  it('loads with bounded scoring, evidence, and stale-state guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the evaluation-strategy system of record.');
    expect(skill!.content).toContain('Pass/fail criteria must not have target scores.');
    expect(skill!.content).toContain('Weighted target scores must not exceed the published weight.');
    expect(skill!.content).toContain('Reviewed strategies require registered evidence locators or existing evidence artifacts.');
    expect(skill!.content).toContain('Do not state win probability or competitor claims as fact without sourced scenario evidence.');
    expect(skill!.content).toContain('A stale capability pack is not ready.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
