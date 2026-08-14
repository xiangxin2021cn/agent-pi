import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyFileIfNewer,
  tenderOfficialOutputOwnerId,
  tenderOfficialOutputsDir,
} from './tender-official-outputs.ts';

describe('tender official outputs paths', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('owner id is the session id', () => {
    expect(tenderOfficialOutputOwnerId('260812-still-clover', '573')).toBe('260812-still-clover');
    expect(tenderOfficialOutputOwnerId('  ', '573')).toBe('573');
    expect(tenderOfficialOutputOwnerId(undefined, '573')).toBe('573');
  });

  test('session work products land under Official Outputs', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-official-outputs-'));
    const ownerId = tenderOfficialOutputOwnerId('260812-still-clover', '573');
    expect(tenderOfficialOutputsDir(root, ownerId, 'boq-pricing')).toBe(
      join(root, 'Agent Pi Outputs', '260812-still-clover', 'boq-pricing'),
    );
  });

  test('does not copy a file onto itself', () => {
    root = mkdtempSync(join(tmpdir(), 'tender-official-outputs-'));
    const file = join(tenderOfficialOutputsDir(root, '260812-still-clover', 'boq-pricing'), 'note.md');
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '# note\n', 'utf8');
    expect(copyFileIfNewer(file, file)).toBe(false);
  });
});
