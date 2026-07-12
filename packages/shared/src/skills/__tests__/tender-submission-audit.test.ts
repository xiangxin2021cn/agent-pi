import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-submission-audit';

describe('Tender Submission Audit project skill', () => {
  it('loads with assembly, source-boundary, and red-team guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the submission-audit system of record.');
    expect(skill!.content).toContain('exactly one current submission item');
    expect(skill!.content).toContain('required capability packs are ready and non-stale');
    expect(skill!.content).toContain('Do not insert red-team findings into the formal bid narrative.');
    expect(skill!.content).toContain('Do not claim submission-ready');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
