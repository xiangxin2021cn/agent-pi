import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-boq-reconciliation';

describe('Tender BOQ Reconciliation project skill', () => {
  it('loads with exact-location, source-boundary, and quantity guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the BOQ reconciliation system of record.');
    expect(skill!.content).toContain('Record the exact BOQ document, sheet, and cell or range.');
    expect(skill!.content).toContain('Every analyzed BOQ item needs supporting scope references or an explicit gap.');
    expect(skill!.content).toContain('Never label a calculated or assumed quantity as a sourced BOQ quantity.');
    expect(skill!.content).toContain('Do not perform cost pricing in this skill.');
    expect(skill!.content).toContain('A stale capability pack is not ready.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
