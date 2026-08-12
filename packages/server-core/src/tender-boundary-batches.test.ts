import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TenderProjectBoundaryPack } from '@agent-pi/business-core/tender';
import { createOrRefreshBoundaryBatchManifest, mergeBoundaryParseReports } from './tender-boundary-batches.ts';
import { normalizeBoundarySource } from './tender-boundary-sources.ts';

function basePack(projectId: string): TenderProjectBoundaryPack {
  return {
    schemaVersion: 1,
    projectId,
    profileId: 'generic-international',
    jurisdiction: { currency: 'USD' },
    standards: {
      technicalSpecs: [],
      measurementStandard: { id: 'employer-spec', title: 'Employer measurement' },
    },
    pricing: {
      pricingStandard: 'generic_direct_cost_v1',
      indirectCostPolicy: 'exclude_from_item_direct_cost',
      taxRegime: { vatTreatment: 'exclusive' },
      ratePolicy: { location: 'Site', mustVerifyOnline: [], allowUnverifiedLabel: true },
    },
    productivity: { basis: 'user_provided', sources: [] },
    bidderResources: { outline: 'Owned plant limited.' },
    organizationOutline: { text: '' },
    readiness: 'draft',
  };
}

describe('tender-boundary-batches', () => {
  test('creates one parse batch per path source and merges inventory into the pack', () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-batches-'));
    try {
      const plant = normalizeBoundarySource({
        kind: 'bidder_resource',
        title: 'fleet.xlsx',
        path: join(root, 'fleet.xlsx'),
      });
      const kb = normalizeBoundarySource({
        kind: 'knowledge_standard',
        title: 'COTO',
        knowledgeSlug: 'coto',
      });
      writeFileSync(plant.path!, 'plant');
      const manifest = createOrRefreshBoundaryBatchManifest(root, 'n3', [plant, kb], { projectRoot: root });
      expect(manifest.batchCount).toBe(1);
      expect(manifest.batches[0]?.sourceId).toBe(plant.id);

      const batch = manifest.batches[0]!;
      mkdirSync(dirname(batch.reportPath), { recursive: true });
      mkdirSync(dirname(batch.markdownPath), { recursive: true });
      writeFileSync(batch.reportPath, JSON.stringify({
        schemaVersion: 1,
        batchId: batch.batchId,
        sourceId: plant.id,
        summary: 'Owned graders and water trucks listed in the fleet sheet.',
        technicalSpecs: [],
        inventory: {
          plant: ['14H grader', 'water truck'],
          labour: ['grader operator'],
          materialSources: [],
          constraints: ['night shift banned in town'],
        },
        organizationNotes: 'Camp at km 12 with plant yard on the south side of the alignment for this contract.',
      }));
      writeFileSync(batch.markdownPath, '# Fleet\n\nOwned plant extracted from the bidder register.\n');
      const refreshed = createOrRefreshBoundaryBatchManifest(root, 'n3', [plant, kb], { projectRoot: root });
      expect(refreshed.completedBatches).toBe(1);

      const merged = mergeBoundaryParseReports({
        pack: basePack('n3'),
        sources: [plant, kb],
        manifest: refreshed,
      });
      expect(merged.extractedInventory?.plant).toEqual(['14H grader', 'water truck']);
      expect(merged.bidderResources.ownedPlant).toEqual(['14H grader', 'water truck']);
      expect(merged.organizationOutline.text.length).toBeGreaterThan(40);
      expect(merged.boundarySources?.find((source) => source.id === plant.id)?.parseStatus).toBe('parsed');
      expect(merged.boundarySources?.find((source) => source.id === kb.id)?.parseStatus).toBe('not_required');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
