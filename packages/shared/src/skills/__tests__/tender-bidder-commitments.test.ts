import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-bidder-commitments';

describe('Tender Bidder Commitments project skill', () => {
  it('requires explicit user confirmation between BOQ calculation and construction planning', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('calculated BOQ demand');
    expect(skill!.content).toContain('bidder-confirmed proposed inputs');
    expect(skill!.content).toContain('Do not mark this stage ready until the user explicitly confirms');
    expect(skill!.content).toContain('Address every category explicitly');
    expect(skill!.content).toContain('owned transfer, new purchase, local hire');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('capability `bidder_commitments`');
  });
});
