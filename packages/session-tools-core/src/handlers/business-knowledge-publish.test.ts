import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type SessionToolContext } from '../context.ts';

describe('business_knowledge_publish handler', () => {
  let root = '';
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('publishes an explicit plugin artifact and returns an importable knowledge snapshot', async () => {
    root = mkdtempSync(join(tmpdir(), 'business-knowledge-publish-'));
    const workingDirectory = join(root, 'project');
    const artifactPath = join(workingDirectory, 'approved-strategy.json');
    await Bun.write(artifactPath, '{"approved":true}\n');
    const context: SessionToolContext = {
      sessionId: 'publish-session', workspacePath: workingDirectory, sourcesPath: join(workingDirectory, 'sources'),
      skillsPath: join(workingDirectory, 'skills'), plansFolderPath: join(workingDirectory, 'plans'), workingDirectory,
      knowledgeBaseRegistryRootPath: join(root, 'config'),
      callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} }, fs: createNodeFileSystem(), loadSourceConfig: () => null,
    };
    const handlers = await import('./index.ts') as Record<string, unknown>;
    expect(typeof handlers.handleBusinessKnowledgePublish).toBe('function');
    const result = await (handlers.handleBusinessKnowledgePublish as Function)(context, {
      artifactPath, publicationId: 'n3-tender-strategy-v4', producerPlugin: 'tender', producerWorkspaceId: 'n3-tender',
      producerRevision: 4, title: 'Approved strategy', category: 'Projects/N3', approvalState: 'approved',
      userConfirmed: true, snapshotId: 'n3-tender-strategy-copy',
    });
    const output = JSON.parse(result.content[0]?.text ?? '{}');
    expect(result.isError).toBe(false);
    expect(output.publication.managedArtifactPath).toContain(join('knowledge-base', 'business-publications'));
    expect(output.snapshot).toMatchObject({ id: 'n3-tender-strategy-copy', producerPlugin: 'tender', approvalState: 'approved', userConfirmed: true });
  });
});
