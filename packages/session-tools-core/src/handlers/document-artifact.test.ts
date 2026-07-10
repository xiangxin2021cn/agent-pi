import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import { createNodeFileSystem } from '../context.ts';
import { handleDocumentArtifact } from './document-artifact.ts';

describe('document_artifact transactional writer', () => {
  let rootDir: string;
  let sessionDir: string;
  let workingDir: string;
  let context: SessionToolContext;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'document-artifact-'));
    sessionDir = join(rootDir, 'workspace', 'sessions', 'session-1');
    workingDir = join(rootDir, 'project');
    mkdirSync(join(sessionDir, 'data'), { recursive: true });
    mkdirSync(workingDir, { recursive: true });
    context = {
      sessionId: 'session-1',
      workspacePath: join(rootDir, 'workspace'),
      sourcesPath: join(rootDir, 'workspace', 'sources'),
      skillsPath: join(rootDir, 'workspace', 'skills'),
      plansFolderPath: join(sessionDir, 'plans'),
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: createNodeFileSystem(),
      loadSourceConfig: () => null,
      getSessionInfo: () => ({
        id: 'session-1',
        name: 'Session 1',
        labels: [],
        status: 'todo',
        permissionMode: 'allow-all',
        createdAt: 1,
        workingDirectory: workingDir,
        isActive: true,
      }),
      sessionPath: sessionDir,
      dataPath: join(sessionDir, 'data'),
    };
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('persists section content and reports missing required sections', async () => {
    await initArtifact(context);
    const writeResult = await handleDocumentArtifact(context, {
      action: 'write_section',
      artifactId: 'final-report',
      sectionId: 'scope',
      content: '# Scope\n\nOnly Chapter 1.',
    });
    expect(writeResult.isError).toBe(false);

    const prepareResult = await handleDocumentArtifact(context, {
      action: 'prepare_merge',
      artifactId: 'final-report',
    });
    expect(prepareResult.isError).toBe(true);
    expect(prepareResult.content[0]?.text).toContain('evidence');

    const statusResult = await handleDocumentArtifact(context, {
      action: 'status',
      artifactId: 'final-report',
    });
    expect(statusResult.content[0]?.text).toContain('"writtenSections": 1');
    expect(statusResult.content[0]?.text).toContain('"missingRequiredSections"');
  });

  it('assembles a complete artifact into the formal output directory and validates content', async () => {
    await initArtifact(context);
    await writeSection(context, 'scope', '# Scope\n\nOnly Chapter 1.');
    await writeSection(context, 'evidence', '# Evidence\n\nSource: COTO Chapter 1.');

    const prepareResult = await handleDocumentArtifact(context, {
      action: 'prepare_merge',
      artifactId: 'final-report',
    });
    expect(prepareResult.isError).toBe(false);

    const assembleResult = await handleDocumentArtifact(context, {
      action: 'assemble',
      artifactId: 'final-report',
    });
    expect(assembleResult.isError).toBe(false);

    const outputPath = join(workingDir, 'Agent Pi Outputs', 'session-1', 'final.md');
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, 'utf-8')).toBe('# Scope\n\nOnly Chapter 1.\n\n# Evidence\n\nSource: COTO Chapter 1.\n');

    const validateResult = await handleDocumentArtifact(context, {
      action: 'validate',
      artifactId: 'final-report',
      requiredStrings: ['Only Chapter 1.', 'Source: COTO Chapter 1.'],
    });
    expect(validateResult.isError).toBe(false);
    expect(validateResult.content[0]?.text).toContain('"valid": true');
  });

  it('rejects assembly when a section changed after prepare_merge', async () => {
    await initArtifact(context);
    await writeSection(context, 'scope', '# Scope\n\nFirst draft.');
    await writeSection(context, 'evidence', '# Evidence\n\nSource A.');
    await handleDocumentArtifact(context, { action: 'prepare_merge', artifactId: 'final-report' });

    await writeSection(context, 'scope', '# Scope\n\nChanged after audit.');
    const result = await handleDocumentArtifact(context, {
      action: 'assemble',
      artifactId: 'final-report',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('prepare_merge again');
  });

  it('rejects whitespace-only section content', async () => {
    await initArtifact(context);

    const result = await handleDocumentArtifact(context, {
      action: 'write_section',
      artifactId: 'final-report',
      sectionId: 'scope',
      content: '   \n\t',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('must not be empty');
  });

  it('rejects path traversal in artifact IDs and output file names', async () => {
    const artifactResult = await handleDocumentArtifact(context, {
      action: 'init',
      artifactId: '../escape',
      outputFile: 'final.md',
      sections: [],
    });
    expect(artifactResult.isError).toBe(true);

    const outputResult = await handleDocumentArtifact(context, {
      action: 'init',
      artifactId: 'safe-id',
      outputFile: '../escape.md',
      sections: [],
    });
    expect(outputResult.isError).toBe(true);
  });

  it('does not prepare an artifact with no written sections', async () => {
    await handleDocumentArtifact(context, {
      action: 'init',
      artifactId: 'empty-report',
      outputFile: 'empty.md',
      sections: [],
    });

    const result = await handleDocumentArtifact(context, {
      action: 'prepare_merge',
      artifactId: 'empty-report',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('at least one non-empty section');
  });

  it('rejects a tampered manifest section path', async () => {
    await initArtifact(context);
    const manifestPath = join(context.dataPath!, 'document-artifacts', 'final-report', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    manifest.sections[0].file = '../../outside.md';
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');

    const result = await handleDocumentArtifact(context, {
      action: 'status',
      artifactId: 'final-report',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('manifest is invalid');
  });

  it('rejects a final artifact changed after assembly', async () => {
    await initArtifact(context);
    await writeSection(context, 'scope', '# Scope\n\nOnly Chapter 1.');
    await writeSection(context, 'evidence', '# Evidence\n\nSource A.');
    await handleDocumentArtifact(context, { action: 'prepare_merge', artifactId: 'final-report' });
    await handleDocumentArtifact(context, { action: 'assemble', artifactId: 'final-report' });

    const outputPath = join(workingDir, 'Agent Pi Outputs', 'session-1', 'final.md');
    writeFileSync(outputPath, '', 'utf-8');
    const result = await handleDocumentArtifact(context, {
      action: 'validate',
      artifactId: 'final-report',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('changed after assembly');
  });

  it('uses context workingDirectory when getSessionInfo is unavailable', async () => {
    const codexContext: SessionToolContext = {
      ...context,
      workingDirectory: workingDir,
      getSessionInfo: undefined,
    };
    await initArtifact(codexContext);
    await writeSection(codexContext, 'scope', '# Scope\n\nOnly Chapter 1.');
    await writeSection(codexContext, 'evidence', '# Evidence\n\nSource A.');
    await handleDocumentArtifact(codexContext, { action: 'prepare_merge', artifactId: 'final-report' });

    const result = await handleDocumentArtifact(codexContext, {
      action: 'assemble',
      artifactId: 'final-report',
    });

    expect(result.isError).toBe(false);
    expect(existsSync(join(workingDir, 'Agent Pi Outputs', 'session-1', 'final.md'))).toBe(true);
  });
});

async function initArtifact(context: SessionToolContext) {
  return handleDocumentArtifact(context, {
    action: 'init',
    artifactId: 'final-report',
    outputFile: 'final.md',
    sections: [
      { id: 'scope', title: 'Scope', order: 1, required: true },
      { id: 'evidence', title: 'Evidence', order: 2, required: true },
    ],
  });
}

async function writeSection(context: SessionToolContext, sectionId: string, content: string) {
  return handleDocumentArtifact(context, {
    action: 'write_section',
    artifactId: 'final-report',
    sectionId,
    content,
  });
}
