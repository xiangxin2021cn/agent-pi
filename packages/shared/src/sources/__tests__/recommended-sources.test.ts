import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANYSEARCH_API_KEYS_URL,
  ANYSEARCH_DOCS_URL,
  ANYSEARCH_MCP_URL,
  ANYSEARCH_SOURCE_ID,
  ANYSEARCH_SOURCE_SLUG,
  getRecommendedSourceTemplate,
  installRecommendedSource,
  isSourceUsable,
  loadSourceConfig,
  loadSource,
  markSourceAuthenticated,
} from '../index.ts';

let workspaceRoot: string | null = null;

afterEach(() => {
  if (workspaceRoot) {
    rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = null;
  }
});

function tempWorkspace(): string {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'recommended-sources-'));
  return workspaceRoot;
}

describe('recommended sources', () => {
  test('AnySearch MCP template is available but disabled by default', () => {
    const template = getRecommendedSourceTemplate(ANYSEARCH_SOURCE_ID);

    expect(template.slug).toBe(ANYSEARCH_SOURCE_SLUG);
    expect(template.config.enabled).toBe(false);
    expect(template.config.isAuthenticated).toBe(false);
    expect(template.config.connectionStatus).toBe('needs_auth');
    expect(template.config.mcp?.transport).toBe('http');
    expect(template.config.mcp?.url).toBe(ANYSEARCH_MCP_URL);
    expect(template.config.mcp?.authType).toBe('bearer');
  });

  test('installing AnySearch writes a disabled source and guide links', async () => {
    const root = tempWorkspace();
    const config = await installRecommendedSource(root, ANYSEARCH_SOURCE_ID);

    expect(config.slug).toBe(ANYSEARCH_SOURCE_SLUG);
    expect(config.enabled).toBe(false);
    expect(config.connectionStatus).toBe('needs_auth');

    const loaded = loadSource(root, ANYSEARCH_SOURCE_SLUG);
    expect(loaded).not.toBeNull();
    expect(isSourceUsable(loaded!)).toBe(false);

    const guide = readFileSync(join(root, 'sources', ANYSEARCH_SOURCE_SLUG, 'guide.md'), 'utf-8');
    expect(guide).toContain(ANYSEARCH_DOCS_URL);
    expect(guide).toContain(ANYSEARCH_API_KEYS_URL);
    expect(guide).toContain('disabled by default');
    expect(guide).toContain('must not happen as a silent fallback');
  });

  test('installing AnySearch is idempotent and does not enable an existing source', async () => {
    const root = tempWorkspace();
    const first = await installRecommendedSource(root, ANYSEARCH_SOURCE_ID);
    const second = await installRecommendedSource(root, ANYSEARCH_SOURCE_ID);

    expect(second.id).toBe(first.id);
    expect(second.enabled).toBe(false);
    expect(second.isAuthenticated).toBe(false);
  });

  test('marking AnySearch authenticated still does not enable the source', async () => {
    const root = tempWorkspace();
    await installRecommendedSource(root, ANYSEARCH_SOURCE_ID);

    markSourceAuthenticated(root, ANYSEARCH_SOURCE_SLUG);

    const config = loadSourceConfig(root, ANYSEARCH_SOURCE_SLUG);
    expect(config?.isAuthenticated).toBe(true);
    expect(config?.connectionStatus).toBe('connected');
    expect(config?.enabled).toBe(false);

    const loaded = loadSource(root, ANYSEARCH_SOURCE_SLUG);
    expect(loaded).not.toBeNull();
    expect(isSourceUsable(loaded!)).toBe(false);
  });
});
