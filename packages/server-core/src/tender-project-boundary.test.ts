import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyBoundarySourcesToPack,
  buildSanralProjectBoundaryDraft,
  looksLikeSanralBoundProject,
  projectBoundarySoftGateMissing,
  readProjectBoundaryPack,
  suggestProjectBoundaryDraftFromBindings,
  writeProjectBoundaryPack,
} from './tender-project-boundary.ts';
import {
  defaultTenderKnowledgeBindings,
  sanralTenderKnowledgeBindings,
} from './tender-bindings.ts';
import { organizationOutlineMeetsMinimum } from '@agent-pi/business-core/tender';

describe('tender-project-boundary', () => {
  test('migrates SA draft from SANRAL profile bindings', () => {
    const bindings = sanralTenderKnowledgeBindings();
    expect(looksLikeSanralBoundProject(bindings)).toBe(true);
    const draft = buildSanralProjectBoundaryDraft({
      projectId: 'r573',
      bindings,
    });
    expect(draft.profileId).toBe('sa-sanral-highway');
    expect(draft.pricing.pricingStandard).toBe('c51_pure_direct_cost_v1');
    expect(draft.jurisdiction.currency).toBe('ZAR');
    expect(organizationOutlineMeetsMinimum(draft.organizationOutline.text)).toBe(true);
    expect(projectBoundarySoftGateMissing(draft)).toEqual([]);
  });

  test('changing fence sources clears human confirmation', () => {
    const draft = buildSanralProjectBoundaryDraft({ projectId: 'r573' });
    const confirmed = { ...draft, humanConfirmedAt: '2026-08-12T10:00:00.000Z', readiness: 'ready' as const };
    const next = applyBoundarySourcesToPack(confirmed, [{
      id: 'bnd-new',
      kind: 'bidder_resource',
      role: 'plant',
      title: 'fleet.xlsx',
      path: 'C:/bidder/fleet.xlsx',
      parseStatus: 'registered',
    }]);
    expect(next.humanConfirmedAt).toBeUndefined();
    expect(next.readiness).toBe('needs_review');
    expect(projectBoundarySoftGateMissing(next)).toEqual([]);
  });

  test('suggests SA draft when pack missing and bindings look SANRAL', () => {
    const root = mkdtempSync(join(tmpdir(), 'tender-boundary-'));
    try {
      mkdirSync(join(root, 'packs'), { recursive: true });
      writeFileSync(
        join(root, 'bindings.json'),
        `${JSON.stringify(sanralTenderKnowledgeBindings(), null, 2)}\n`,
        'utf8',
      );
      const suggested = suggestProjectBoundaryDraftFromBindings({
        projectDirectory: root,
        projectId: 'r573',
      });
      expect(suggested?.source).toBe('sa-sanral-bindings');
      expect(suggested?.draft.pricing.pricingStandard).toBe('c51_pure_direct_cost_v1');

      writeProjectBoundaryPack(root, {
        schemaVersion: 1,
        capability: 'project_boundary',
        projectId: 'r573',
        revision: 1,
        coreRevision: 1,
        upstream: [{ capability: 'core', revision: 1 }, { capability: 'document_analysis', revision: 1 }],
        updatedAt: new Date().toISOString(),
        data: suggested!.draft,
      });
      expect(readProjectBoundaryPack(root)?.data.profileId).toBe('sa-sanral-highway');
      expect(suggestProjectBoundaryDraftFromBindings({ projectDirectory: root, projectId: 'r573' })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('new generic defaults do not look SANRAL-bound', () => {
    expect(looksLikeSanralBoundProject(defaultTenderKnowledgeBindings())).toBe(false);
  });

  test('suggests generic draft when pack missing and bindings are not SANRAL', () => {
    const root = mkdtempSync(join(tmpdir(), 'tender-boundary-generic-'));
    try {
      mkdirSync(join(root, 'packs'), { recursive: true });
      writeFileSync(
        join(root, 'bindings.json'),
        `${JSON.stringify(defaultTenderKnowledgeBindings(), null, 2)}\n`,
        'utf8',
      );
      const suggested = suggestProjectBoundaryDraftFromBindings({
        projectDirectory: root,
        projectId: 'namibia-road',
      });
      expect(suggested?.source).toBe('generic');
      expect(suggested?.draft.profileId).toBe('generic-international');
      expect(suggested?.draft.pricing.pricingStandard).toBe('generic_direct_cost_v1');
      expect(suggested?.draft.boundarySources?.some((source) => source.role === 'method')).toBe(true);
      expect(projectBoundarySoftGateMissing(suggested!.draft)).toEqual(['project_boundary:outline']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
