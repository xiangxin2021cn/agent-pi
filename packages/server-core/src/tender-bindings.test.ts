import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyTenderProfileBindings,
  defaultTenderKnowledgeBindings,
  ensureDefaultTenderBindings,
  getTenderJurisdictionProfile,
  loadTenderProfilesRegistry,
  pricingStandardForProfile,
  resolveDefaultBindings,
  resolveTenderBindingPath,
  sanralTenderKnowledgeBindings,
} from './tender-bindings.ts';
import {
  buildSanralProjectBoundaryDraft,
  looksLikeSanralBoundProject,
  projectBoundarySoftGateMissing,
  suggestProjectBoundaryDraftFromBindings,
} from './tender-project-boundary.ts';
import { createOrRefreshBoqBatchManifest } from './tender-boq-batches.ts';
import type { TenderBoqReconciliationData } from '@agent-pi/business-core/tender';

function resourcesKnowledge(...parts: string[]): string {
  const fromServerCore = join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', 'knowledge', ...parts);
  if (fromServerCore.includes('knowledge')) return fromServerCore;
  return join(process.cwd(), 'apps', 'electron', 'resources', 'knowledge', ...parts);
}

describe('tender knowledge bindings (V2.6 profiles)', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('registry defaults to generic-international', () => {
    const registry = loadTenderProfilesRegistry();
    expect(registry.defaultProfileId).toBe('generic-international');
    expect(pricingStandardForProfile('generic-international')).toBe('generic_direct_cost_v1');
    expect(pricingStandardForProfile('sa-sanral-highway')).toBe('c51_pure_direct_cost_v1');
    expect(getTenderJurisdictionProfile('sa-sanral-highway').knowledgePack).toContain('tender-sa-sanral');
  });

  test('new projects write generic bindings by default (D2)', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-generic-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'demo');
    mkdirSync(projectDirectory, { recursive: true });

    const bindings = ensureDefaultTenderBindings(projectDirectory);
    expect(bindings.profileId).toBe('generic-international');
    expect(bindings.pricing.methodStandard.path).toContain('tender-generic');
    expect(bindings.pricing.methodStandard.path).not.toContain('C5.1');
    expect(looksLikeSanralBoundProject(bindings)).toBe(false);
    expect(defaultTenderKnowledgeBindings().pricing.methodStandard.path).toContain('tender-generic');
  });

  test('SA profile still resolves C5.1 method standard from bundle', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-sa-'));
    const projectDirectory = join(root, 'project');
    mkdirSync(projectDirectory, { recursive: true });

    const bindings = applyTenderProfileBindings(projectDirectory, 'sa-sanral-highway');
    expect(bindings.profileId).toBe('sa-sanral-highway');
    expect(bindings.pricing.methodStandard.path).toContain('C5.1');
    expect(looksLikeSanralBoundProject(bindings)).toBe(true);

    const bundleRoot = resourcesKnowledge('tender-sa-sanral');
    const resolved = resolveTenderBindingPath({
      projectDirectory,
      bindingPath: bindings.pricing.methodStandard.path,
      bundledKnowledgeRoot: bundleRoot,
    });
    expect(resolved.source).toBe('bundle');
    expect(resolved.absolutePath.endsWith('C5.1_路床_单价推导.md')).toBe(true);
  });

  test('generic profile resolves tender-generic method note', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-generic-resolve-'));
    const projectDirectory = join(root, 'project');
    mkdirSync(projectDirectory, { recursive: true });
    const bindings = resolveDefaultBindings('generic-international');
    writeFileSync(join(projectDirectory, 'bindings.json'), `${JSON.stringify(bindings, null, 2)}\n`);

    const bundleRoot = resourcesKnowledge('tender-generic');
    const resolved = resolveTenderBindingPath({
      projectDirectory,
      bindingPath: bindings.pricing.methodStandard.path,
      bundledKnowledgeRoot: bundleRoot,
    });
    expect(resolved.absolutePath.endsWith('generic_direct_cost_five_step.md')).toBe(true);
  });

  test('project override wins over bundle', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-override-'));
    const projectDirectory = join(root, 'project');
    mkdirSync(projectDirectory, { recursive: true });
    const overrideRel = 'knowledge/tender-generic/generic_direct_cost_five_step.md';
    const overridePath = join(projectDirectory, overrideRel);
    mkdirSync(join(overridePath, '..'), { recursive: true });
    writeFileSync(overridePath, '# override\n', 'utf8');
    ensureDefaultTenderBindings(projectDirectory);

    const resolved = resolveTenderBindingPath({
      projectDirectory,
      bindingPath: overrideRel,
      bundledKnowledgeRoot: join(root, 'missing-bundle'),
    });
    expect(resolved.source).toBe('project');
    expect(resolved.absolutePath).toBe(overridePath);
  });
});

describe('v2.6 boundary profile regression', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('SA fixture: SA profile → BOQ brief keeps C51 + SANRAL method path', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-profile-sa-boq-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'r573');
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    applyTenderProfileBindings(projectDirectory, 'sa-sanral-highway');

    const draft = buildSanralProjectBoundaryDraft({
      projectId: 'r573',
      bindings: sanralTenderKnowledgeBindings(),
    });
    expect(draft.pricing.pricingStandard).toBe('c51_pure_direct_cost_v1');
    expect(projectBoundarySoftGateMissing(draft)).toEqual([]);

    writeFileSync(join(projectDirectory, 'packs', 'project-boundary.json'), `${JSON.stringify({
      schemaVersion: 1,
      capability: 'project_boundary',
      projectId: 'r573',
      revision: 1,
      coreRevision: 1,
      upstream: [{ capability: 'core', revision: 1 }, { capability: 'document_analysis', revision: 1 }],
      updatedAt: new Date().toISOString(),
      data: draft,
    }, null, 2)}\n`);

    const boq: TenderBoqReconciliationData = {
      items: [{
        id: 'item-1',
        code: '5.1.1',
        description: 'Cut to spoil',
        unit: 'm3',
        quantity: '100',
        quantityBasis: 'boq',
        quantityStatus: 'sourced',
        quantityRefs: [{ documentId: 'boq', sheet: 'C5.1', cell: 'F1' }],
        source: { documentId: 'boq', sheet: 'C5.1', cell: 'A1' },
      }],
      scopeLinks: [{
        boqItemId: 'item-1',
        requirementIds: [],
        specificationRefs: [{ documentId: 'spec', clause: 'C5.1.1' }],
        drawingRefs: [],
        measurementRuleRefs: [],
        inclusions: [],
        exclusions: [],
        assumptions: [],
        gapStatus: 'clear',
      }],
      openItems: [],
    } as any;

    const manifest = createOrRefreshBoqBatchManifest(projectDirectory, 'r573', boq, new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
      ['spec', 'C:/inputs/Specification.pdf'],
    ]), { projectRoot: root });
    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8'));
    expect(brief.qualityStandard.id).toBe('c51_pure_direct_cost_v1');
    expect(brief.projectBoundary.pricingStandard).toBe('c51_pure_direct_cost_v1');
    expect(brief.projectBoundary.profileId).toBe('sa-sanral-highway');
    expect(String(brief.methodStandard?.path ?? '')).toMatch(/C5\.1|tender-sa-sanral/);
  });

  test('generic fixture: no COTO in objective; soft gate requires outline', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-profile-generic-boq-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'namibia');
    mkdirSync(join(projectDirectory, 'packs'), { recursive: true });
    applyTenderProfileBindings(projectDirectory, 'generic-international');

    const suggested = suggestProjectBoundaryDraftFromBindings({
      projectDirectory,
      projectId: 'namibia',
    });
    expect(suggested?.source).toBe('generic');
    expect(suggested?.draft.pricing.pricingStandard).toBe('generic_direct_cost_v1');
    expect(projectBoundarySoftGateMissing(suggested!.draft)).toContain('project_boundary:outline');

    const pack = {
      ...suggested!.draft,
      organizationOutline: {
        text: 'Establish camps near km 0 and km 20; sequence earthworks ahead of pavement; '
          + 'protect school frontage; confirm borrow with EMP conditions before pricing.',
      },
      readiness: 'needs_review' as const,
    };
    expect(projectBoundarySoftGateMissing(pack)).toEqual([]);

    writeFileSync(join(projectDirectory, 'packs', 'project-boundary.json'), `${JSON.stringify({
      schemaVersion: 1,
      capability: 'project_boundary',
      projectId: 'namibia',
      revision: 1,
      coreRevision: 1,
      upstream: [{ capability: 'core', revision: 1 }, { capability: 'document_analysis', revision: 1 }],
      updatedAt: new Date().toISOString(),
      data: pack,
    }, null, 2)}\n`);

    const boq: TenderBoqReconciliationData = {
      items: [{
        id: 'item-1',
        code: 'A.1',
        description: 'Excavate foundation',
        unit: 'm3',
        quantity: '50',
        quantityBasis: 'boq',
        quantityStatus: 'sourced',
        quantityRefs: [{ documentId: 'boq', sheet: 'Bill 1', cell: 'F1' }],
        source: { documentId: 'boq', sheet: 'Bill 1', cell: 'A1' },
      }],
      scopeLinks: [{
        boqItemId: 'item-1',
        requirementIds: [],
        specificationRefs: [],
        drawingRefs: [],
        measurementRuleRefs: [],
        inclusions: [],
        exclusions: [],
        assumptions: [],
        gapStatus: 'clear',
      }],
      openItems: [],
    } as any;

    const manifest = createOrRefreshBoqBatchManifest(projectDirectory, 'namibia', boq, new Map([
      ['boq', 'C:/inputs/BOQ.xlsx'],
    ]), { projectRoot: root });
    const brief = JSON.parse(readFileSync(manifest.batches[0]!.briefPath, 'utf8'));
    expect(brief.qualityStandard.id).toBe('generic_direct_cost_v1');
    expect(brief.objective.toLowerCase()).not.toContain('coto');
    expect(brief.projectBoundary.organizationOutlineExcerpt.length).toBeGreaterThan(40);
  });
});
