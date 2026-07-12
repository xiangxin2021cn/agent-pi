import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-schedule-resource-planning';

describe('Tender Schedule and Resource Planning project skill', () => {
  it('loads with CPM, resource, source, and product-boundary guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the schedule-resource system of record.');
    expect(skill!.content).toContain('Require a ready, non-stale `execution_plan`.');
    expect(skill!.content).toContain('Record a programme start date, calendars, positive durations, duration bases, and predecessor logic.');
    expect(skill!.content).toContain('Do not invent productivity, calendars, lags, resource capacity, or contractual milestones.');
    expect(skill!.content).toContain('Render Gantt outputs only from the validated structured schedule.');
    expect(skill!.content).toContain('Do not create or overwrite a Project Delivery Controls baseline.');
    expect(skill!.content).toContain('A stale capability pack is not ready.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
