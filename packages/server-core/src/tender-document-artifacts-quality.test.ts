import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artifactLooksAcceptable,
  documentArtifactLooksMetaDense,
} from './tender-document-artifacts.ts';

describe('document artifact soft quality', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('flags meta-dense path dumps without blocking empty check', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-meta-dense-'));
    const path = join(root, 'note.md');
    writeFileSync(path, [
      '# Analysis',
      '',
      '- documentId: abc',
      '- batchId: batch-1',
      '- reportPath: C:/tmp/report.json',
      '- markdownPath: C:/tmp/note.md',
      '- allowedSources: foo',
      '- Working Folder: C:/tmp',
      '- knowledge/tender-sa-sanral/x.md',
    ].join('\n'));
    expect(artifactLooksAcceptable(path)).toBe(true);
    expect(documentArtifactLooksMetaDense(path)).toBe(true);
  });

  test('professional body is not meta-dense', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-meta-ok-'));
    const path = join(root, 'note.md');
    writeFileSync(path, [
      '# Health and Safety Specification',
      '',
      'Mandatory HSE officer ratios apply on school grounds.',
      'Traffic accommodation during demolitions must be priced.',
      'Clarify night-work windows with the Employer.',
    ].join('\n'));
    expect(documentArtifactLooksMetaDense(path)).toBe(false);
  });
});
