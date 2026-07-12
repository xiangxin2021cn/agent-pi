import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-execution-planning';

describe('Tender Execution Planning project skill', () => {
  it('loads with work-package, source, and product-boundary guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the tender execution-plan system of record.');
    expect(skill!.content).toContain('Assign every reconciled BOQ item to exactly one primary work package.');
    expect(skill!.content).toContain('Do not invent productivity, resource quantities, engineering controls, or temporary works.');
    expect(skill!.content).toContain('Keep HSE controls, environmental controls, interfaces, constraints, and hold points explicit.');
    expect(skill!.content).toContain('Do not create or overwrite a Project Delivery Controls baseline.');
    expect(skill!.content).toContain('A stale capability pack is not ready.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
