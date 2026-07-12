import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { createNodeFileSystem } from '../context.ts';
import { handleTenderWorkspace } from './tender-workspace.ts';

function resultJson(result: Awaited<ReturnType<typeof handleTenderWorkspace>>): any {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

describe('tender_workspace handler', () => {
  let root: string;
  let workingDirectory: string;
  let context: SessionToolContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tender-workspace-'));
    workingDirectory = join(root, 'project');
    context = {
      sessionId: 'session-1',
      workspacePath: join(root, 'workspace'),
      sourcesPath: join(root, 'workspace', 'sources'),
      skillsPath: join(root, 'workspace', 'skills'),
      plansFolderPath: join(root, 'workspace', 'plans'),
      workingDirectory,
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: createNodeFileSystem(),
      loadSourceConfig: () => null,
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('requires an explicit session working directory', async () => {
    context.workingDirectory = undefined;
    const result = await handleTenderWorkspace(context, {
      action: 'status',
      projectId: 'n3-upgrade',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('working directory');
  });

  test('rejects project path traversal', async () => {
    const result = await handleTenderWorkspace(context, {
      action: 'init',
      projectId: '../escape',
      project: { id: '../escape', title: 'Escape', status: 'active' },
    });
    expect(result.isError).toBe(true);
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  test('initializes the project-local tender model and audit files', async () => {
    const result = await handleTenderWorkspace(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      project: {
        id: 'n3-upgrade',
        title: 'N3 Upgrade Tender',
        status: 'active',
      },
    });

    expect(result.isError).toBe(false);
    const output = resultJson(result);
    expect(output.workspace.revision).toBe(1);
    expect(existsSync(output.modelPath)).toBe(true);
    expect(existsSync(output.auditPath)).toBe(true);
    expect(output.modelPath).toContain(join('.agent-pi', 'business', 'tender', 'n3-upgrade'));
  });

  test('rejects an invalid staged reference without mutating the model', async () => {
    await handleTenderWorkspace(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      project: { id: 'n3-upgrade', title: 'N3 Upgrade Tender', status: 'active' },
    });

    const result = await handleTenderWorkspace(context, {
      action: 'upsert_requirements',
      projectId: 'n3-upgrade',
      requirements: [
        {
          id: 'req-site-visit',
          title: 'Compulsory site visit',
          text: 'Attend the compulsory site clarification meeting.',
          type: 'mandatory',
          criticality: 'critical',
          source: { documentId: 'missing-book', page: 12 },
          evidenceNeeded: ['Signed attendance certificate'],
          status: 'open',
        },
      ],
    });

    expect(result.isError).toBe(true);
    const modelPath = join(
      workingDirectory,
      '.agent-pi',
      'business',
      'tender',
      'n3-upgrade',
      'tender-workspace.json',
    );
    const persisted = JSON.parse(readFileSync(modelPath, 'utf8'));
    expect(persisted.revision).toBe(1);
    expect(persisted.requirements).toEqual([]);
  });

  test('upserts in dependency order and returns deterministic validation', async () => {
    await handleTenderWorkspace(context, {
      action: 'init',
      projectId: 'n3-upgrade',
      project: { id: 'n3-upgrade', title: 'N3 Upgrade Tender', status: 'active' },
    });
    await handleTenderWorkspace(context, {
      action: 'upsert_documents',
      projectId: 'n3-upgrade',
      documents: [
        {
          id: 'book-1',
          name: 'Tender Book 1',
          path: 'C:/tender/Book 1.pdf',
          kind: 'tender_data',
          status: 'active',
        },
      ],
    });
    const update = await handleTenderWorkspace(context, {
      action: 'upsert_requirements',
      projectId: 'n3-upgrade',
      requirements: [
        {
          id: 'req-site-visit',
          title: 'Compulsory site visit',
          text: 'Attend the compulsory site clarification meeting.',
          type: 'mandatory',
          criticality: 'critical',
          source: { documentId: 'book-1', page: 12 },
          evidenceNeeded: ['Signed attendance certificate'],
          status: 'open',
        },
      ],
    });
    expect(resultJson(update).workspace.revision).toBe(3);

    const validation = await handleTenderWorkspace(context, {
      action: 'validate',
      projectId: 'n3-upgrade',
    });
    const output = resultJson(validation);
    expect(output.audit.readiness).toBe('not_ready');
    expect(output.audit.issues.map((issue: any) => issue.code)).toContain('mandatory_requirement_uncovered');

    const restartedContext = { ...context };
    const status = await handleTenderWorkspace(restartedContext, {
      action: 'status',
      projectId: 'n3-upgrade',
    });
    expect(resultJson(status).workspace.revision).toBe(3);
    const projectDirectory = join(workingDirectory, '.agent-pi', 'business', 'tender', 'n3-upgrade');
    expect(readdirSync(projectDirectory).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});
