import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inferBoundarySourceRole,
  normalizeBoundarySource,
  parseableBoundarySources,
  readBoundarySourceRegistry,
  writeBoundarySourceRegistry,
} from './tender-boundary-sources.ts';

describe('tender-boundary-sources', () => {
  test('infers roles and skips tender-spec bindings from parse batches', () => {
    expect(inferBoundarySourceRole({ kind: 'bidder_resource', title: 'Plant register.xlsx' })).toBe('plant');
    expect(inferBoundarySourceRole({ kind: 'knowledge_standard', title: 'COTO 2020' })).toBe('primary_spec');
    const spec = normalizeBoundarySource({
      kind: 'tender_spec_binding',
      title: 'Volume 3 Specification.pdf',
      path: 'C:/tender/spec.pdf',
      documentId: 'src-spec',
    });
    const plant = normalizeBoundarySource({
      kind: 'bidder_resource',
      title: 'fleet.xlsx',
      path: 'C:/bidder/fleet.xlsx',
    });
    const kb = normalizeBoundarySource({
      kind: 'knowledge_standard',
      title: 'C5.1 method',
      knowledgeSlug: 'c51-method',
    });
    expect(spec.parseStatus).toBe('not_required');
    expect(plant.parseStatus).toBe('registered');
    expect(kb.parseStatus).toBe('not_required');
    expect(parseableBoundarySources([spec, plant, kb]).map((source) => source.kind)).toEqual(['bidder_resource']);
  });

  test('registry replace keeps parseStatus when the same corpus is re-registered', () => {
    const root = mkdtempSync(join(tmpdir(), 'boundary-sources-'));
    try {
      writeBoundarySourceRegistry(root, 'n3', [{
        kind: 'bidder_resource',
        title: 'fleet.xlsx',
        path: 'C:/bidder/fleet.xlsx',
        parseStatus: 'parsed',
      }]);
      const again = writeBoundarySourceRegistry(root, 'n3', [{
        kind: 'bidder_resource',
        title: 'fleet.xlsx',
        path: 'C:/bidder/fleet.xlsx',
      }]);
      expect(again.sources).toHaveLength(1);
      expect(again.sources[0]?.parseStatus).toBe('parsed');
      expect(readBoundarySourceRegistry(root, 'n3').sources[0]?.title).toBe('fleet.xlsx');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
