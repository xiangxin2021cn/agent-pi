import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'

const electronDir = join(import.meta.dir, '..', '..')

describe('Windows Git installer packaging', () => {
  it('keeps the bundled Git installer version consistent across packaging hooks', () => {
    const beforePack = readFileSync(join(electronDir, 'scripts', 'beforePack.cjs'), 'utf8')
    const nsisInclude = readFileSync(join(electronDir, 'build', 'install-git.nsh'), 'utf8')
    const buildWin = readFileSync(join(electronDir, 'scripts', 'build-win.ps1'), 'utf8')
    const installGit = readFileSync(join(electronDir, 'resources', 'installers', 'windows', 'install-git-if-needed.ps1'), 'utf8')

    expect(beforePack).toContain("const GIT_FOR_WINDOWS_VERSION = '2.55.0'")
    expect(beforePack).toContain('Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe')
    expect(beforePack).toContain('stageHelperServers(context)')
    expect(beforePack).toContain('stageKoffiForPiServer(context, workspaceRoot, piResourceDir)')
    expect(beforePack).toContain('packages\', \'pi-agent-server')
    expect(beforePack).toContain('stageClaudeAgentSdk(context)')
    expect(beforePack).toContain('claude-agent-sdk-binary')
    expect(beforePack).toContain('stageRipgrep(context)')
    expect(nsisInclude).toContain('Git-2.55.0-64-bit.exe')
    expect(nsisInclude).toContain('-BundledVersion "2.55.0"')
    expect(buildWin).toContain('$GitForWindowsVersion = "2.55.0"')
    expect(buildWin).toContain('Git-$GitForWindowsVersion-64-bit.exe')
    expect(installGit).toContain('Add-DirectoryToUserPathFront')
    expect(installGit).toContain('Notify-EnvironmentChanged')
  })

  it('includes the Git installer resources and NSIS hook in electron-builder config', () => {
    const config = yaml.load(
      readFileSync(join(electronDir, 'electron-builder.yml'), 'utf8'),
    ) as {
      beforePack?: string
      nsis?: { include?: string }
      win?: { extraResources?: Array<{ from?: string; to?: string }> }
    }

    expect(config.beforePack).toBe('scripts/beforePack.cjs')
    expect(config.nsis?.include).toBe('build/install-git.nsh')
    expect(config.win?.extraResources).toContainEqual({
      from: 'resources/installers/windows',
      to: 'installers/windows',
    })
  })
})
