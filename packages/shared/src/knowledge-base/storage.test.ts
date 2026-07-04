import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getKnowledgeBaseIndexPath,
  getKnowledgeBaseRegistryPath,
  loadKnowledgeBaseRegistry,
  upsertKnowledgeBaseRegistryEntry,
} from './storage.ts';

describe('knowledge base registry storage', () => {
  test('loads an empty registry when no file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-registry-'));
    try {
      expect(loadKnowledgeBaseRegistry(root)).toEqual({ version: 1, entries: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('upserts and normalizes local-global knowledge base entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-registry-'));
    try {
      const registry = upsertKnowledgeBaseRegistryEntry(root, {
        sourceSlug: 'file-memory-standard',
        name: 'Company Standard',
        sourceFilePath: '/project/company-standard.md',
        originalSourceFilePath: '/project/original/company-standard.md',
        workspacePath: '/workspace',
        collectionId: 'local-file-memory',
        knowledgeCategory: ' Standards \\ Method Statements ',
        knowledgeFolder: ' Standards \\ Method Statements ',
        scope: 'global',
        sourceKind: 'file-memory',
        fileExtension: '.md',
        createdAt: 10,
        updatedAt: 20,
      });

      expect(registry.entries).toHaveLength(1);
      expect(registry.entries[0]).toMatchObject({
        sourceSlug: 'file-memory-standard',
        collectionId: 'local-file-memory',
        knowledgeCategory: 'Standards/Method Statements',
        knowledgeFolder: 'Standards/Method Statements',
        scope: 'global',
        sourceKind: 'file-memory',
        originalSourceFilePath: '/project/original/company-standard.md',
      });
      expect(existsSync(getKnowledgeBaseRegistryPath(root))).toBe(true);
      expect(JSON.parse(readFileSync(getKnowledgeBaseRegistryPath(root), 'utf-8')).entries).toHaveLength(1);
      expect(existsSync(getKnowledgeBaseIndexPath(root))).toBe(true);

      const index = readFileSync(getKnowledgeBaseIndexPath(root), 'utf-8');
      expect(index).toContain('# Agent Pi Knowledge Base Index');
      expect(index).toContain('## Standards/Method Statements');
      expect(index).toContain('Company Standard');
      expect(index).toContain('file-memory-standard');
      expect(index).toContain('/project/original/company-standard.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('replaces an existing entry with the same source slug', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-registry-'));
    try {
      upsertKnowledgeBaseRegistryEntry(root, {
        sourceSlug: 'file-memory-standard',
        name: 'Company Standard',
        sourceFilePath: '/project/company-standard.md',
        knowledgeCategory: 'Standards',
        knowledgeFolder: 'Standards',
        scope: 'global',
        sourceKind: 'file-memory',
        fileExtension: '.md',
        createdAt: 10,
        updatedAt: 20,
      });
      const registry = upsertKnowledgeBaseRegistryEntry(root, {
        sourceSlug: 'file-memory-standard',
        name: 'Company Standard v2',
        sourceFilePath: '/project/company-standard-v2.md',
        knowledgeCategory: 'Standards',
        knowledgeFolder: 'Standards',
        scope: 'global',
        sourceKind: 'file-memory',
        fileExtension: '.md',
        createdAt: 10,
        updatedAt: 30,
      });

      expect(registry.entries).toHaveLength(1);
      const entry = registry.entries[0];
      if (!entry) throw new Error('Expected one registry entry');
      expect(entry.name).toBe('Company Standard v2');
      expect(entry.sourceFilePath).toBe('/project/company-standard-v2.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
