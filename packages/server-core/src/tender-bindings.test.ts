import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultTenderKnowledgeBindings,
  ensureDefaultTenderBindings,
  resolveTenderBindingPath,
} from './tender-bindings.ts';

describe('tender knowledge bindings', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('writes defaults and resolves bundle file', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'n3');
    mkdirSync(projectDirectory, { recursive: true });

    const bindings = ensureDefaultTenderBindings(projectDirectory);
    expect(bindings.pricing.methodStandard.path).toContain('C5.1');

    const bundleRoot = join(
      process.cwd().includes('packages\\server-core') || process.cwd().includes('packages/server-core')
        ? join(process.cwd(), '..', '..', 'apps', 'electron', 'resources', 'knowledge', 'tender-sa-sanral')
        : join(process.cwd(), 'apps', 'electron', 'resources', 'knowledge', 'tender-sa-sanral'),
    );

    const resolved = resolveTenderBindingPath({
      projectDirectory,
      bindingPath: bindings.pricing.methodStandard.path,
      bundledKnowledgeRoot: bundleRoot,
    });
    expect(resolved.source).toBe('bundle');
    expect(resolved.absolutePath.endsWith('C5.1_路床_单价推导.md')).toBe(true);
  });

  test('project override wins over bundle', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-override-'));
    const projectDirectory = join(root, 'project');
    mkdirSync(projectDirectory, { recursive: true });
    const overrideRel = 'knowledge/tender-sa-sanral/C5.1_路床_单价推导.md';
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

  test('default bindings expose C5.1 method standard title', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-bindings-method-'));
    const projectDirectory = join(root, 'project');
    mkdirSync(projectDirectory, { recursive: true });
    const defaults = defaultTenderKnowledgeBindings();
    writeFileSync(join(projectDirectory, 'bindings.json'), JSON.stringify(defaults, null, 2));
    const fakeBundle = join(root, 'bundle');
    mkdirSync(fakeBundle, { recursive: true });
    writeFileSync(join(fakeBundle, 'C5.1_路床_单价推导.md'), '# c51\n', 'utf8');

    const resolved = resolveTenderBindingPath({
      projectDirectory,
      bindingPath: defaults.pricing.methodStandard.path,
      bundledKnowledgeRoot: fakeBundle,
    });
    expect(defaults.pricing.methodStandard.title).toContain('C5.1');
    expect(ensureDefaultTenderBindings(projectDirectory).pricing.methodStandard.title).toContain('C5.1');
    expect(resolved.absolutePath).toBe(join(fakeBundle, 'C5.1_路床_单价推导.md'));
  });
});
