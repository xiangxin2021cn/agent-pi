import { describe, expect, it } from 'bun:test'
import { dump } from 'js-yaml'
import { mergeMacUpdateManifests } from './merge-mac-update-manifests'

describe('mergeMacUpdateManifests', () => {
  it('combines arm64 and x64 files into one updater manifest', () => {
    const arm64 = manifest('2.1.0', 'arm64', '2026-07-10T10:00:00.000Z')
    const x64 = manifest('2.1.0', 'x64', '2026-07-10T11:00:00.000Z')

    const merged = mergeMacUpdateManifests(arm64, x64)

    expect(merged.version).toBe('2.1.0')
    expect(merged.files.map(file => file.url)).toEqual([
      'Agent-Pi-arm64.dmg',
      'Agent-Pi-arm64.zip',
      'Agent-Pi-x64.dmg',
      'Agent-Pi-x64.zip',
    ])
    expect(merged.path).toBe('Agent-Pi-x64.zip')
    expect(merged.sha512).toBe('x64-zip-hash')
    expect(merged.releaseDate).toBe('2026-07-10T11:00:00.000Z')
  })

  it('rejects manifests with different versions', () => {
    expect(() => mergeMacUpdateManifests(
      manifest('2.1.0', 'arm64', '2026-07-10T10:00:00.000Z'),
      manifest('2.0.1', 'x64', '2026-07-10T10:00:00.000Z'),
    )).toThrow('versions differ')
  })
})

function manifest(version: string, architecture: 'arm64' | 'x64', releaseDate: string): string {
  return dump({
    version,
    files: [{
      url: `Agent-Pi-${architecture}.zip`,
      sha512: `${architecture}-zip-hash`,
      size: 100,
    }, {
      url: `Agent-Pi-${architecture}.dmg`,
      sha512: `${architecture}-dmg-hash`,
      size: 120,
    }],
    path: `Agent-Pi-${architecture}.zip`,
    sha512: `${architecture}-zip-hash`,
    releaseDate,
  })
}
