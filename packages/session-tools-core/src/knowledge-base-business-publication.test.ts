import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBusinessKnowledgePublications, publishBusinessKnowledgeArtifact, toBusinessEvidenceSnapshot } from './knowledge-base-business-publication.ts';

describe('enterprise knowledge business publication storage', () => {
  test('copies an approved business artifact into immutable hash-addressed knowledge storage', () => {
    const root = mkdtempSync(join(tmpdir(), 'business-publication-'));
    try {
      const source = join(root, 'source.json');
      writeFileSync(source, '{"value":1}\n', 'utf8');
      const publication = publishBusinessKnowledgeArtifact(root, source, {
        publicationId: 'tender-n3-strategy-v4', producerPlugin: 'tender', producerWorkspaceId: 'n3-tender',
        producerRevision: 4, title: 'Approved tender strategy', category: 'Projects/N3',
        approvalState: 'approved', userConfirmed: true, publishedAt: '2026-07-12T10:00:00.000Z',
      });
      expect(publication.managedArtifactPath).toContain(join('knowledge-base', 'business-publications', 'tender', 'n3-tender', publication.contentSha256));
      expect(existsSync(publication.managedArtifactPath)).toBe(true);
      expect(readFileSync(publication.managedArtifactPath, 'utf8')).toBe('{"value":1}\n');
      expect(loadBusinessKnowledgePublications(root).entries).toEqual([publication]);
      expect(toBusinessEvidenceSnapshot(publication, 'delivery-copy', '2026-07-12T11:00:00.000Z')).toMatchObject({
        id: 'delivery-copy', producerPlugin: 'tender', producerWorkspaceId: 'n3-tender', producerRevision: 4,
        contentSha256: publication.contentSha256, approvalState: 'approved', userConfirmed: true,
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('rejects replacing an immutable publication ID with different content', () => {
    const root = mkdtempSync(join(tmpdir(), 'business-publication-'));
    try {
      const source = join(root, 'source.json');
      const metadata = { publicationId: 'same-id', producerPlugin: 'investment' as const, producerWorkspaceId: 'mine', producerRevision: 1, title: 'Model', category: 'Investment', approvalState: 'approved' as const, userConfirmed: true as const, publishedAt: '2026-07-12T10:00:00.000Z' };
      writeFileSync(source, 'one', 'utf8');
      publishBusinessKnowledgeArtifact(root, source, metadata);
      writeFileSync(source, 'two', 'utf8');
      expect(() => publishBusinessKnowledgeArtifact(root, source, metadata)).toThrow('immutable');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
