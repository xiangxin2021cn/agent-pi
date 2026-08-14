import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertDocumentParseGate,
  documentArtifactPath,
  ensureDocumentReviewEntries,
  markDocumentHumanReview,
} from './tender-document-artifacts.ts';

describe('tender document artifacts / human review', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('gate fails without md and acceptance, clears after both', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-doc-artifacts-'));
    const projectDirectory = join(root, '.agent-pi', 'business', 'tender', 'n3');
    mkdirSync(projectDirectory, { recursive: true });

    let ledger = ensureDocumentReviewEntries(projectDirectory, 'n3', root, [
      { documentId: 'book1', name: 'Book 1.pdf' },
    ]);
    expect(assertDocumentParseGate(ledger, ['book1'])).toEqual([
      'document-review:missing-md:book1',
    ]);

    const artifactPath = documentArtifactPath(root, 'n3', 'book1', 'Book 1.pdf');
    mkdirSync(join(root, 'Agent Pi Outputs', 'n3', 'document-analysis'), { recursive: true });
    writeFileSync(artifactPath, '# Book 1\n\n## 摘要\n\nKey tender constraints for the employer.\n', 'utf8');

    ledger = markDocumentHumanReview({
      projectDirectory,
      projectId: 'n3',
      projectRoot: root,
      documentId: 'book1',
      humanReview: 'accepted',
    });
    expect(assertDocumentParseGate(ledger, ['book1'])).toEqual([]);
  });
});
