import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-cost-cashflow-planning';

describe('Tender Cost and Cash-Flow Planning project skill', () => {
  it('loads with source, exact-arithmetic, scenario, and product-boundary guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');
    expect(skill!.content).toContain('Use only user-selected sources and registered Tender Workspace records.');
    expect(skill!.content).toContain('Do not scan the working directory.');
    expect(skill!.content).toContain('Use `tender_capability` as the cost-cash-flow system of record.');
    expect(skill!.content).toContain('Require ready, non-stale `boq_reconciliation` and `schedule_resources` packs.');
    expect(skill!.content).toContain('Do not use JavaScript floating-point arithmetic for financial reconciliation.');
    expect(skill!.content).toContain('Every sourced rate needs a registered source, currency, and effective date.');
    expect(skill!.content).toContain('Do not embed hard-coded market rates or productivity benchmarks.');
    expect(skill!.content).toContain('Do not create or overwrite a Project Delivery Controls budget baseline.');
    expect(skill!.content).toContain('A stale capability pack is not ready.');
    expect(skill!.content).toContain('Pause for user confirmation');
  });
});
