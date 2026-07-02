/**
 * electron-builder beforePack hook
 *
 * Stages bundled prerequisites that must exist before extraResources are
 * collected. This is intentionally in electron-builder instead of only in
 * build-win.ps1 so direct `electron:dist:*` entrypoints cannot ship stale SDKs.
 */

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GIT_FOR_WINDOWS_VERSION = '2.55.0';
const GIT_FOR_WINDOWS_INSTALLER = `Git-${GIT_FOR_WINDOWS_VERSION}-64-bit.exe`;
const GIT_FOR_WINDOWS_URL =
  `https://github.com/git-for-windows/git/releases/download/v${GIT_FOR_WINDOWS_VERSION}.windows.1/${GIT_FOR_WINDOWS_INSTALLER}`;
const MIN_GIT_INSTALLER_BYTES = 50 * 1024 * 1024;
const MINERU_OPEN_API_VERSION = '0.5.9';
const MIN_MINERU_OPEN_API_BYTES = 1024 * 1024;

module.exports = async function beforePack(context) {
  stageHelperServers(context);
  stageClaudeAgentSdk(context);
  stageRipgrep(context);
  stageMineruOpenApi(context);

  if (context.electronPlatformName === 'win32') {
    const installerPath = path.join(
      context.packager.projectDir,
      'resources',
      'installers',
      'windows',
      GIT_FOR_WINDOWS_INSTALLER,
    );

    await ensureGitForWindowsInstaller(installerPath);
  }
};

function stageHelperServers(context) {
  const projectDir = context.packager.projectDir;
  const workspaceRoot = path.resolve(projectDir, '..', '..');

  stageBundledServer({
    label: 'Session MCP server',
    workspaceRoot,
    source: path.join(workspaceRoot, 'packages', 'session-mcp-server', 'src', 'index.ts'),
    output: path.join(workspaceRoot, 'packages', 'session-mcp-server', 'dist', 'index.js'),
    resource: path.join(projectDir, 'resources', 'session-mcp-server', 'index.js'),
    args: ['--target', 'node', '--format', 'cjs'],
  });

  stageBundledServer({
    label: 'File memory MCP server',
    workspaceRoot,
    source: path.join(workspaceRoot, 'packages', 'file-memory-mcp-server', 'src', 'index.ts'),
    output: path.join(workspaceRoot, 'packages', 'file-memory-mcp-server', 'dist', 'index.js'),
    resource: path.join(projectDir, 'resources', 'file-memory-mcp-server', 'index.js'),
    args: ['--target', 'node', '--format', 'cjs'],
  });

  const piPackageDir = path.join(workspaceRoot, 'packages', 'pi-agent-server');
  const piSource = path.join(piPackageDir, 'src', 'index.ts');
  if (fs.existsSync(piSource)) {
    const piDist = path.join(piPackageDir, 'dist');
    runBun(
      [
        'build',
        piSource,
        '--outdir',
        piDist,
        '--target',
        'bun',
        '--format',
        'esm',
        '--external',
        'koffi',
      ],
      workspaceRoot,
      'Pi agent server',
    );

    const piOutput = path.join(piDist, 'index.js');
    const piResourceDir = path.join(projectDir, 'resources', 'pi-agent-server');
    copyFile(piOutput, path.join(piResourceDir, 'index.js'));
    stageKoffiForPiServer(context, workspaceRoot, piResourceDir);
    console.log('beforePack: staged Pi agent server');
  }
}

function stageBundledServer({ label, workspaceRoot, source, output, resource, args }) {
  if (!fs.existsSync(source)) {
    throw new Error(`${label} source is missing: ${source}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  runBun(['build', source, '--outfile', output, ...args], workspaceRoot, label);
  copyFile(output, resource);
  console.log(`beforePack: staged ${label}`);
}

function runBun(args, cwd, label) {
  const result = spawnSync(resolveBunCommand(), args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} build failed with exit code ${result.status}`);
  }
}

function resolveBunCommand() {
  const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const candidates = [
    process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, 'bin', binary) : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, '.bun', 'bin', binary) : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.bun', 'bin', binary) : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'bun';
}

function copyFile(source, dest) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required packaged resource is missing: ${source}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function stageKoffiForPiServer(context, workspaceRoot, piResourceDir) {
  const source = path.join(workspaceRoot, 'node_modules', 'koffi');
  const dest = path.join(piResourceDir, 'node_modules', 'koffi');
  if (!fs.existsSync(source)) {
    throw new Error(`koffi is missing from workspace node_modules: ${source}`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of ['package.json', 'index.js', 'indirect.js', 'index.d.ts', 'lib']) {
    const src = path.join(source, entry);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(dest, entry), { recursive: true });
    }
  }

  const targetDir = `${context.electronPlatformName}_${normalizeBuilderArch(context.arch)}`;
  const nativeSource = path.join(source, 'build', 'koffi', targetDir);
  if (!fs.existsSync(nativeSource)) {
    throw new Error(`koffi native binary is missing for ${targetDir}: ${nativeSource}`);
  }

  fs.cpSync(nativeSource, path.join(dest, 'build', 'koffi', targetDir), { recursive: true });
}

function stageClaudeAgentSdk(context) {
  const projectDir = context.packager.projectDir;
  const workspaceRoot = path.resolve(projectDir, '..', '..');
  const scopeRoot = path.join(projectDir, 'node_modules', '@anthropic-ai');
  const sourceScopeRoot = path.join(workspaceRoot, 'node_modules', '@anthropic-ai');
  const coreSource = path.join(sourceScopeRoot, 'claude-agent-sdk');
  const coreDest = path.join(scopeRoot, 'claude-agent-sdk');
  const binaryPackage = getClaudeAgentSdkBinaryPackage(context);
  const binarySource = path.join(sourceScopeRoot, binaryPackage);
  const binaryDest = path.join(scopeRoot, 'claude-agent-sdk-binary');

  copyDirectory(coreSource, coreDest);
  copyDirectory(binarySource, binaryDest);
  assertClaudeBinary(binaryDest, context.electronPlatformName);

  const version = readPackageVersion(coreDest);
  console.log(`beforePack: staged Claude Agent SDK ${version} (${binaryPackage})`);
}

function stageRipgrep(context) {
  const projectDir = context.packager.projectDir;
  const workspaceRoot = path.resolve(projectDir, '..', '..');
  const source = path.join(workspaceRoot, 'node_modules', '@vscode', 'ripgrep');
  const dest = path.join(projectDir, 'node_modules', '@vscode', 'ripgrep');

  copyDirectory(source, dest);
  console.log('beforePack: staged @vscode/ripgrep');
}

function stageMineruOpenApi(context) {
  const projectDir = context.packager.projectDir;
  const workspaceRoot = path.resolve(projectDir, '..', '..');
  const platform = context.electronPlatformName;
  const arch = normalizeBuilderArch(context.arch);
  const platformKey = `${platform}-${arch}`;
  const packageName = `mineru-open-api-${platformKey}`;
  const binaryName = platform === 'win32' ? 'mineru-open-api.exe' : 'mineru-open-api';
  let packageDir = path.join(workspaceRoot, 'node_modules', packageName);
  let tempPackageDir;

  if (!fs.existsSync(path.join(packageDir, 'bin', binaryName))) {
    tempPackageDir = fetchNpmPackage(packageName, MINERU_OPEN_API_VERSION);
    packageDir = tempPackageDir;
  }

  try {
    const sourceBinary = path.join(packageDir, 'bin', binaryName);
    const destBinary = path.join(projectDir, 'resources', 'bin', platformKey, binaryName);
    copyFile(sourceBinary, destBinary);
    if (platform !== 'win32') {
      fs.chmodSync(destBinary, 0o755);
    }
    assertMineruOpenApiBinary(destBinary);
    console.log(`beforePack: staged MinerU Open API ${MINERU_OPEN_API_VERSION} (${platformKey})`);
  } finally {
    if (tempPackageDir) {
      fs.rmSync(path.dirname(tempPackageDir), { recursive: true, force: true });
    }
  }
}

function getClaudeAgentSdkBinaryPackage(context) {
  const arch = normalizeBuilderArch(context.arch);
  const platform = context.electronPlatformName;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new Error(`Unsupported Claude Agent SDK platform: ${platform}`);
  }
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported Claude Agent SDK arch: ${String(context.arch)}`);
  }
  return `claude-agent-sdk-${platform}-${arch}`;
}

function normalizeBuilderArch(arch) {
  if (arch === 1 || arch === 'x64') return 'x64';
  if (arch === 3 || arch === 'arm64') return 'arm64';
  return arch;
}

function copyDirectory(source, dest) {
  if (!fs.existsSync(source)) {
    throw new Error(`Required packaged resource is missing: ${source}`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
}

function assertClaudeBinary(binaryDest, platform) {
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude';
  const binaryPath = path.join(binaryDest, binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Claude Agent SDK binary is missing: ${binaryPath}`);
  }
  const size = fs.statSync(binaryPath).size;
  if (size < 50 * 1024 * 1024) {
    throw new Error(`Claude Agent SDK binary is too small: ${binaryPath} (${size} bytes)`);
  }
}

function assertMineruOpenApiBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`MinerU Open API binary is missing: ${binaryPath}`);
  }
  const size = fs.statSync(binaryPath).size;
  if (size < MIN_MINERU_OPEN_API_BYTES) {
    throw new Error(`MinerU Open API binary is too small: ${binaryPath} (${size} bytes)`);
  }
}

function fetchNpmPackage(packageName, version) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${packageName}-`));
  const result = runNpmPack(tempDir, packageName, version);

  if (result.error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw result.error;
  }
  if (result.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const stderr = result.stderr?.trim();
    throw new Error(`npm pack ${packageName}@${version} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }

  const tarballName = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!tarballName) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`npm pack ${packageName}@${version} did not produce a tarball`);
  }

  const tarResult = spawnSync('tar', ['-xzf', tarballName], {
    cwd: tempDir,
    stdio: 'inherit',
  });
  if (tarResult.error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw tarResult.error;
  }
  if (tarResult.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`extracting ${tarballName} failed with exit code ${tarResult.status}`);
  }

  return path.join(tempDir, 'package');
}

function runNpmPack(cwd, packageName, version) {
  const args = ['pack', `${packageName}@${version}`];
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', resolveNpmCommand(), ...args], {
      cwd,
      encoding: 'utf8',
    });
  }

  return spawnSync(resolveNpmCommand(), args, {
    cwd,
    encoding: 'utf8',
  });
}

function resolveNpmCommand() {
  if (process.platform !== 'win32') {
    return 'npm';
  }

  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'npm.cmd') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs', 'npm.cmd') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'npm.cmd') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'npm.cmd';
}

function readPackageVersion(packageDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return packageJson.version ?? 'unknown';
}

async function ensureGitForWindowsInstaller(installerPath) {
  if (fs.existsSync(installerPath)) {
    const size = fs.statSync(installerPath).size;
    if (size >= MIN_GIT_INSTALLER_BYTES) {
      console.log(`beforePack: using bundled Git for Windows installer ${installerPath}`);
      return;
    }
    fs.rmSync(installerPath, { force: true });
  }

  fs.mkdirSync(path.dirname(installerPath), { recursive: true });
  const tempPath = `${installerPath}.download`;

  console.log(`beforePack: downloading Git for Windows ${GIT_FOR_WINDOWS_VERSION}`);
  try {
    await downloadFile(GIT_FOR_WINDOWS_URL, tempPath);
    const size = fs.statSync(tempPath).size;
    if (size < MIN_GIT_INSTALLER_BYTES) {
      throw new Error(`downloaded Git installer is too small: ${size} bytes`);
    }
    fs.renameSync(tempPath, installerPath);
    console.log(`beforePack: staged ${GIT_FOR_WINDOWS_INSTALLER} (${Math.round(size / 1024 / 1024)} MB)`);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function downloadFile(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`failed to download ${url}: HTTP ${status}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(600_000, () => {
      request.destroy(new Error(`timeout downloading ${url}`));
    });
  });
}
