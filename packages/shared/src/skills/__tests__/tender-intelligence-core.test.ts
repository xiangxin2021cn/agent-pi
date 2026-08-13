import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-intelligence-core';
const SKILLS_DIR = join(PROJECT_ROOT, '.agents', 'skills');
const TENDER_STAGE_SKILLS = [
  'tender-intelligence-core',
  'tender-formal-writing',
  'tender-document-parsing',
  'tender-project-boundary',
  'tender-boq-reconciliation',
  'tender-evaluation-strategy',
  'tender-boq-five-step-pricing',
  'tender-bidder-commitments',
  'tender-execution-planning',
  'tender-schedule-resource-planning',
  'tender-cost-cashflow-planning',
  'tender-submission-documents',
  'tender-submission-audit',
  'construction-schedule-planner',
];

describe('Tender Intelligence Core project skill', () => {
  it('loads with the approved source and readiness guardrails', () => {
    const skill = loadSkillBySlug(PROJECT_ROOT, SKILL_SLUG, PROJECT_ROOT);

    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('project');

    const referencesDir = join(skill!.path, 'references');
    const instructions = [
      skill!.content,
      readFileSync(join(referencesDir, 'workflow.md'), 'utf8'),
      readFileSync(join(referencesDir, 'data-model.md'), 'utf8'),
      readFileSync(join(referencesDir, 'readiness-gates.md'), 'utf8'),
      readFileSync(join(referencesDir, 'writing-contract.md'), 'utf8'),
    ].join('\n');

    expect(instructions).toContain('Use only user-selected sources, attached files, and explicitly registered files.');
    expect(instructions).toContain('Register every source document and revision before analyzing it.');
    expect(instructions).toContain('Preserve an exact source locator for every requirement and evaluation criterion.');
    expect(instructions).toContain('Do not use hard-coded rates or productivity benchmarks.');
    expect(instructions).toContain('Do not scan the working directory for source documents.');
    expect(instructions).toContain('Pause for human confirmation when source scope, precedence, or interpretation is ambiguous.');
    expect(instructions).toContain('Run deterministic validation before declaring the tender workflow complete.');
    expect(instructions).toContain('tender-grounded professional bid writing');
    expect(instructions).toContain('Strip AI flavour');
    expect(instructions).toContain('综上所述');
  });

  it('binds every tender stage skill to the chain-wide writing contract', () => {
    const present = new Set(readdirSync(SKILLS_DIR));
    for (const slug of TENDER_STAGE_SKILLS) {
      expect(present.has(slug)).toBe(true);
      const body = readFileSync(join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
      expect(body).toContain('writing-contract.md');
    }
  });
});
