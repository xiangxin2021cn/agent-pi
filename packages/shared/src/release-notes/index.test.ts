import { describe, expect, it } from 'bun:test';
import { resolve } from 'path';
import rootPackageJson from '../../../../package.json';
import { setBundledAssetsRoot } from '../utils/paths.ts';

describe('release notes', () => {
  it('uses the packaged app version as the latest visible release note', async () => {
    setBundledAssetsRoot(resolve(import.meta.dir, '../../../../apps/electron'));

    const { getLatestReleaseVersion, getReleaseNotesList } = await import('./index.ts');

    expect(getLatestReleaseVersion()).toBe(rootPackageJson.version);
    expect(getReleaseNotesList().some(note => note.version === 'next')).toBe(false);
  });
});
