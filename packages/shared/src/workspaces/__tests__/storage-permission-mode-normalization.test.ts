import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspaceConfig } from '../storage.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

describe('workspace storage: config normalization', () => {
  it('maps canonical defaults.permissionMode and cyclablePermissionModes on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-map-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_123',
      name: 'Test Workspace',
      slug: 'test-workspace',
      defaults: {
        permissionMode: 'explore',
        cyclablePermissionModes: ['explore', 'ask', 'execute'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('safe');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['safe', 'ask', 'allow-all']);
  });

  it('falls back to full cycle if persisted cyclablePermissionModes are invalid', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-invalid-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_456',
      name: 'Broken Modes',
      slug: 'broken-modes',
      defaults: {
        permissionMode: 'execute',
        cyclablePermissionModes: ['unknown'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('allow-all');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['safe', 'ask', 'allow-all']);
  });

  it('normalizes legacy defaults.thinkingLevel=think on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-thinking-legacy-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_789',
      name: 'Legacy Thinking',
      slug: 'legacy-thinking',
      defaults: {
        thinkingLevel: 'think',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.thinkingLevel).toBe('medium');
  });

  it('does not enable MinerU document extraction by default', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mineru-default-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_mineru_default',
      name: 'MinerU Default',
      slug: 'mineru-default',
      defaults: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.documentExtraction?.mineru?.enabled).toBeUndefined();
  });

  it('preserves explicit MinerU disabled configuration', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mineru-disabled-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_mineru_disabled',
      name: 'MinerU Disabled',
      slug: 'mineru-disabled',
      defaults: {
        documentExtraction: {
          mineru: {
            enabled: false,
            cleanRepeatedScanNoise: true,
          },
        },
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.documentExtraction?.mineru?.enabled).toBe(false);
    expect(loaded?.defaults?.documentExtraction?.mineru?.cleanRepeatedScanNoise).toBe(true);
  });
});
