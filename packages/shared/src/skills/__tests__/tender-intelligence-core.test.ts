import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { loadSkillBySlug } from '../storage.ts';

const PROJECT_ROOT = resolve(import.meta.dir, '../../../../..');
const SKILL_SLUG = 'tender-intelligence-core';

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
    ].join('\n');

    expect(instructions).toContain('Use only user-selected sources, attached files, and explicitly registered files.');
    expect(instructions).toContain('Register every source document and revision before analyzing it.');
    expect(instructions).toContain('Preserve an exact source locator for every requirement and evaluation criterion.');
    expect(instructions).toContain('Do not use hard-coded rates or productivity benchmarks.');
    expect(instructions).toContain('Do not scan the working directory for source documents.');
    expect(instructions).toContain('Pause for human confirmation when source scope, precedence, or interpretation is ambiguous.');
    expect(instructions).toContain('Run deterministic validation before declaring the tender workflow complete.');
  });
});
