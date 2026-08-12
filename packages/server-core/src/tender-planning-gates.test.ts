import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertPlanningSubstepGate,
  evaluatePlanningSubsteps,
  planningOutputDirectory,
  probeProgrammeXml,
} from './tender-planning-gates.ts';

describe('tender planning gates', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('reports missing artifacts for each substep in order', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-planning-gates-'));
    const projectRoot = join(root, 'project');
    const projectDirectory = join(root, 'business');
    mkdirSync(projectDirectory, { recursive: true });

    const steps = evaluatePlanningSubsteps(projectRoot, projectDirectory, 'n3');
    expect(steps.map((step) => step.id)).toEqual([
      'plan-methodology',
      'plan-programme-resources-cashflow',
      'plan-submission',
    ]);
    expect(steps[0]?.status).toBe('blocked');
    expect(steps[0]?.missingItems).toContain('missing:methodology-md');
    expect(steps[1]?.status).toBe('pending');
    expect(steps[2]?.status).toBe('pending');
  });

  test('4-A completes when methodology MD exists (human review is soft)', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-planning-gates-'));
    const projectRoot = join(root, 'project');
    const projectDirectory = join(root, 'business');
    const planningDir = planningOutputDirectory(projectRoot, 'n3');
    mkdirSync(planningDir, { recursive: true });
    writeFileSync(join(planningDir, '施工策划报告.md'), '# plan\n', 'utf8');

    const steps = evaluatePlanningSubsteps(projectRoot, projectDirectory, 'n3');
    expect(steps[0]?.status).toBe('complete');
    expect(steps[0]?.missingItems).toEqual([]);
    expect(steps[1]?.status).toBe('blocked');
    expect(steps[1]?.missingItems).toContain('missing:programme-xml');
  });

  test('4-B accepts MSP OR P6 plus any resource/cashflow artifact', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-planning-gates-'));
    const projectRoot = join(root, 'project');
    const projectDirectory = join(root, 'business');
    const planningDir = planningOutputDirectory(projectRoot, 'n3');
    mkdirSync(planningDir, { recursive: true });
    writeFileSync(join(planningDir, '施工策划报告.md'), '# plan\n', 'utf8');
    writeFileSync(join(planningDir, 'tender-programme.msp.xml'), '<Project xmlns="http://schemas.microsoft.com/project"></Project>\n');
    writeFileSync(join(planningDir, 'plant-histogram.html'), '<html></html>');

    const steps = evaluatePlanningSubsteps(projectRoot, projectDirectory, 'n3');
    expect(steps[0]?.status).toBe('complete');
    expect(steps[1]?.status).toBe('complete');
    expect(steps[2]?.status).toBe('blocked');
    expect(steps[2]?.missingItems).toContain('missing:submission-artifact');
  });

  test('stage gate lists all incomplete planning probes', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-planning-gates-'));
    const missing = assertPlanningSubstepGate(join(root, 'project'), join(root, 'business'), 'n3');
    expect(missing.some((item) => item.includes('plan-methodology'))).toBe(true);
  });

  test('XML probe rejects non-xml content', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-planning-gates-'));
    const filePath = join(root, 'bad.xml');
    writeFileSync(filePath, 'not xml');
    expect(probeProgrammeXml(filePath, 'msp')).toEqual(['not-xml:msp-xml']);
  });
});
