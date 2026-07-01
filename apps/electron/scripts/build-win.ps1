# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

# Configuration
$BunVersion = "bun-v1.3.9"  # Pinned version for reproducible builds
$BunDownload = "bun-windows-x64-baseline"
$BunExePath = "$ElectronDir\vendor\bun\bun.exe"
$GitForWindowsVersion = "2.55.0"
$GitForWindowsInstallerName = "Git-$GitForWindowsVersion-64-bit.exe"
$GitForWindowsUrl = "https://github.com/git-for-windows/git/releases/download/v$GitForWindowsVersion.windows.1/$GitForWindowsInstallerName"
$GitForWindowsInstallerPath = "$ElectronDir\resources\installers\windows\$GitForWindowsInstallerName"

function Add-BundledBunToPath {
    $BunDir = Split-Path -Parent $BunExePath
    $pathParts = $env:Path -split ';'
    if ($pathParts -notcontains $BunDir) {
        $env:Path = "$BunDir;$env:Path"
    }
}

function Ensure-BundledBun {
    if (Test-Path $BunExePath) {
        Unblock-File -Path $BunExePath -ErrorAction SilentlyContinue
        Add-BundledBunToPath
        Write-Host "Using bundled Bun: $BunExePath" -ForegroundColor Green
        return
    }

    # Use baseline build - works on all x64 CPUs (no AVX2 requirement)
    Write-Host "Downloading Bun $BunVersion for Windows x64 (baseline)..."
    New-Item -ItemType Directory -Force -Path "$ElectronDir\vendor\bun" | Out-Null

    $TempDir = Join-Path $env:TEMP "bun-download-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

    try {
        $ZipUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/$BunDownload.zip"
        $ChecksumUrl = "https://github.com/oven-sh/bun/releases/download/$BunVersion/SHASUMS256.txt"

        Write-Host "Downloading from $ZipUrl..."
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source -L --fail --retry 3 --connect-timeout 20 --max-time 300 -o "$TempDir\$BunDownload.zip" $ZipUrl
            if ($LASTEXITCODE -ne 0) { throw "curl download failed with exit code $LASTEXITCODE" }
            & $curl.Source -L --fail --retry 3 --connect-timeout 20 --max-time 120 -o "$TempDir\SHASUMS256.txt" $ChecksumUrl
            if ($LASTEXITCODE -ne 0) { throw "curl checksum download failed with exit code $LASTEXITCODE" }
        } else {
            Invoke-WebRequest -Uri $ZipUrl -OutFile "$TempDir\$BunDownload.zip"
            Invoke-WebRequest -Uri $ChecksumUrl -OutFile "$TempDir\SHASUMS256.txt"
        }

        Write-Host "Verifying checksum..."
        $ExpectedHash = (Get-Content "$TempDir\SHASUMS256.txt" | Select-String "$BunDownload.zip").ToString().Split(" ")[0]
        $ActualHash = (Get-FileHash "$TempDir\$BunDownload.zip" -Algorithm SHA256).Hash.ToLower()

        if ($ActualHash -ne $ExpectedHash) {
            throw "Checksum verification failed! Expected: $ExpectedHash, Got: $ActualHash"
        }
        Write-Host "Checksum verified successfully" -ForegroundColor Green

        Write-Host "Extracting Bun..."
        try {
            Expand-Archive -Path "$TempDir\$BunDownload.zip" -DestinationPath $TempDir -Force
        } catch {
            Write-Host "Expand-Archive failed, retrying with tar: $_" -ForegroundColor Yellow
            tar -xf "$TempDir\$BunDownload.zip" -C $TempDir
            if ($LASTEXITCODE -ne 0) {
                throw "tar extraction failed with exit code $LASTEXITCODE"
            }
        }

        Unblock-File -Path "$TempDir\$BunDownload\bun.exe" -ErrorAction SilentlyContinue

        Write-Host "Copying bun.exe with robocopy..."
        $robocopyResult = robocopy "$TempDir\$BunDownload" "$ElectronDir\vendor\bun" "bun.exe" /R:5 /W:3 /NP /NFL /NDL
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed with exit code $LASTEXITCODE"
        }

        Write-Host "Bun extracted to: $BunExePath" -ForegroundColor Green
        Write-Host "Waiting for file handles to release..."
        Start-Sleep -Seconds 3
    } finally {
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    }

    Add-BundledBunToPath
}

function Ensure-BundledGitInstaller {
    if (Test-Path $GitForWindowsInstallerPath) {
        Unblock-File -Path $GitForWindowsInstallerPath -ErrorAction SilentlyContinue
        Write-Host "Using bundled Git for Windows installer: $GitForWindowsInstallerPath" -ForegroundColor Green
        return
    }

    Write-Host "Downloading Git for Windows $GitForWindowsVersion x64 installer..."
    $GitInstallerDir = Split-Path -Parent $GitForWindowsInstallerPath
    New-Item -ItemType Directory -Force -Path $GitInstallerDir | Out-Null

    $TempDir = Join-Path $env:TEMP "git-for-windows-download-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    $TempInstaller = Join-Path $TempDir $GitForWindowsInstallerName

    try {
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            & $curl.Source -L --fail --retry 3 --connect-timeout 20 --max-time 600 -o $TempInstaller $GitForWindowsUrl
            if ($LASTEXITCODE -ne 0) { throw "curl Git installer download failed with exit code $LASTEXITCODE" }
        } else {
            Invoke-WebRequest -Uri $GitForWindowsUrl -OutFile $TempInstaller
        }

        $installerSize = (Get-Item $TempInstaller).Length
        if ($installerSize -lt 50000000) {
            throw "Downloaded Git installer is too small: $installerSize bytes"
        }

        Move-Item -Force $TempInstaller $GitForWindowsInstallerPath
        Unblock-File -Path $GitForWindowsInstallerPath -ErrorAction SilentlyContinue
        Write-Host "Git for Windows installer staged: $([math]::Round($installerSize / 1MB, 2)) MB" -ForegroundColor Green
    } finally {
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    }
}

Write-Host "=== Building Agent π Windows Installer using electron-builder ===" -ForegroundColor Cyan

# Debug: System information
Write-Host ""
Write-Host "=== Debug: System Information ===" -ForegroundColor Magenta
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "Temp: $env:TEMP"
Write-Host "Working Dir: $(Get-Location)"

# Debug: Check Windows Defender status
Write-Host ""
Write-Host "=== Debug: Windows Defender Status ===" -ForegroundColor Magenta
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "Antivirus Enabled: $($defenderStatus.AntivirusEnabled)"
        Write-Host "On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        Write-Host "IO AV Protection: $($defenderStatus.IoavProtectionEnabled)"
    } else {
        Write-Host "Could not get Defender status"
    }
} catch {
    Write-Host "Defender status check failed: $_"
}

# Debug: List exclusions
Write-Host ""
Write-Host "=== Debug: Defender Exclusions ===" -ForegroundColor Magenta
try {
    $prefs = Get-MpPreference -ErrorAction SilentlyContinue
    if ($prefs.ExclusionPath) {
        Write-Host "Path Exclusions: $($prefs.ExclusionPath -join ', ')"
    }
    if ($prefs.ExclusionProcess) {
        Write-Host "Process Exclusions: $($prefs.ExclusionProcess -join ', ')"
    }
} catch {
    Write-Host "Could not get exclusions: $_"
}
Write-Host ""

# 0. Kill any lingering processes that might lock files
Write-Host "Killing any lingering node/npm processes..."
$processesToKill = @('node', 'npm', 'electron', 'electron-builder')
foreach ($procName in $processesToKill) {
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# Give processes time to fully terminate
Start-Sleep -Seconds 2

# 1. Clean previous build artifacts (with retry for locked files)
Write-Host "Cleaning previous builds..."
$foldersToClean = @(
    "$ElectronDir\vendor",
    "$ElectronDir\node_modules\@anthropic-ai",
    "$ElectronDir\packages",
    "$ElectronDir\release"
)
foreach ($folder in $foldersToClean) {
    if (Test-Path $folder) {
        $retries = 3
        for ($i = 1; $i -le $retries; $i++) {
            try {
                Remove-Item -Recurse -Force $folder -ErrorAction Stop
                break
            } catch {
                if ($i -eq $retries) { throw }
                Write-Host "  Retrying cleanup of $folder (attempt $i)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
}

# 2. Prepare local Bun runtime and install dependencies
Ensure-BundledBun
Write-Host "Installing dependencies..."
Push-Location $RootDir
try {
    bun install
} finally {
    Pop-Location
}

# 3. Bun is already staged before dependency install so builds work without a global Bun.
Ensure-BundledBun
Ensure-BundledGitInstaller

# 4. Copy SDK from root node_modules (monorepo hoisting).
# Since SDK 0.2.113: thin core + per-platform binary package.
# See apps/electron/scripts/build-dmg.sh for the full rationale.
$SdkSource = "$RootDir\node_modules\@anthropic-ai\claude-agent-sdk"
if (-not (Test-Path $SdkSource)) {
    Write-Host "ERROR: SDK core not found at $SdkSource" -ForegroundColor Red
    Write-Host "Run 'bun install' from the repository root first."
    exit 1
}
Write-Host "Copying SDK core..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@anthropic-ai" | Out-Null
Remove-Item -Recurse -Force "$ElectronDir\node_modules\@anthropic-ai\claude-agent-sdk" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $SdkSource "$ElectronDir\node_modules\@anthropic-ai\"

# 4a. Resolve the target arch's binary package (cross-fetch from npm if absent).
# Target arch is hard-coded x64 — Windows arm64 is not currently shipped.
$SdkBinPkg = "claude-agent-sdk-win32-x64"
$SdkBinSource = "$RootDir\node_modules\@anthropic-ai\$SdkBinPkg"
if (-not (Test-Path $SdkBinSource)) {
    Write-Host "Cross-arch build: $SdkBinPkg not in node_modules — fetching from npm..."
    $SdkVersion = (node -p "require('$RootDir/package.json'.replace(/\\/g, '/')).dependencies['@anthropic-ai/claude-agent-sdk']").Trim('"')
    $PkgTmp = New-Item -ItemType Directory -Path ([System.IO.Path]::Combine($env:TEMP, [System.Guid]::NewGuid().ToString()))
    try {
        Push-Location $PkgTmp
        npm pack "@anthropic-ai/$SdkBinPkg@$SdkVersion" | Out-Null
        $Tarball = Get-ChildItem -Filter "anthropic-ai-*.tgz" | Select-Object -First 1
        tar -xzf $Tarball.Name
        Pop-Location
        New-Item -ItemType Directory -Force -Path $SdkBinSource | Out-Null
        Copy-Item -Recurse -Force "$PkgTmp\package\*" $SdkBinSource
    } finally {
        Remove-Item -Recurse -Force $PkgTmp -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path $SdkBinSource)) {
    Write-Host "ERROR: SDK native binary package ($SdkBinPkg) not found at $SdkBinSource" -ForegroundColor Red
    exit 1
}

Write-Host "Staging SDK native binary as claude-agent-sdk-binary alias..."
$AliasDest = "$ElectronDir\node_modules\@anthropic-ai\claude-agent-sdk-binary"
Remove-Item -Recurse -Force $AliasDest -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $AliasDest | Out-Null
$robocopySdkResult = robocopy $SdkBinSource $AliasDest /E /R:5 /W:3 /NP
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed while staging SDK native binary with exit code $LASTEXITCODE"
}

$BinPath = "$AliasDest\claude.exe"
if (-not (Test-Path $BinPath)) {
    Write-Host "ERROR: Native binary not found at $BinPath" -ForegroundColor Red
    exit 1
}
$BinSize = (Get-Item $BinPath).Length
if ($BinSize -lt 50000000) {
    Write-Host "ERROR: claude.exe is only $BinSize bytes (expected ~210 MB)" -ForegroundColor Red
    exit 1
}
Write-Host "  Native binary: $([math]::Round($BinSize / 1MB)) MB"

# 5. Copy ripgrep (sourced from @vscode/ripgrep since 0.2.113).
$RgSource = "$RootDir\node_modules\@vscode\ripgrep"
if (-not (Test-Path $RgSource) -or -not (Test-Path "$RgSource\bin\rg.exe")) {
    Write-Host "ERROR: @vscode/ripgrep not installed or postinstall did not run" -ForegroundColor Red
    Write-Host "Run 'bun install' and 'bun pm trust @vscode/ripgrep'."
    exit 1
}
Write-Host "Copying @vscode/ripgrep..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@vscode" | Out-Null
Remove-Item -Recurse -Force "$ElectronDir\node_modules\@vscode\ripgrep" -ErrorAction SilentlyContinue
$robocopyRgResult = robocopy $RgSource "$ElectronDir\node_modules\@vscode\ripgrep" /E /R:5 /W:3 /NP
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed while staging @vscode/ripgrep with exit code $LASTEXITCODE"
}

# 6. Copy network interceptor sources (for Pi subprocess; Claude no longer
#    uses --preload — see Phase 2 in plans/sdk-uplift-plan.md).
$InterceptorSource = "$RootDir\packages\shared\src\unified-network-interceptor.ts"
if (-not (Test-Path $InterceptorSource)) {
    Write-Host "ERROR: Interceptor not found at $InterceptorSource" -ForegroundColor Red
    exit 1
}
Write-Host "Copying interceptor (for Pi subprocess)..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\packages\shared\src" | Out-Null
Copy-Item $InterceptorSource "$ElectronDir\packages\shared\src\"
foreach ($dep in @("interceptor-common.ts", "feature-flags.ts", "interceptor-request-utils.ts")) {
    $depPath = "$RootDir\packages\shared\src\$dep"
    if (Test-Path $depPath) {
        Copy-Item $depPath "$ElectronDir\packages\shared\src\"
    }
}

# 6a. Build and stage helper servers into Electron resources.
# electron-builder includes apps/electron/resources/**, so stale helper bundles here
# would ship even when package dist files were rebuilt.
Write-Host "Building and staging helper servers..."
Push-Location $RootDir
try {
    bun build "$RootDir\packages\session-mcp-server\src\index.ts" --outfile "$RootDir\packages\session-mcp-server\dist\index.js" --target node --format cjs
    if ($LASTEXITCODE -ne 0) { throw "Session MCP server build failed" }

    bun build "$RootDir\packages\file-memory-mcp-server\src\index.ts" --outfile "$RootDir\packages\file-memory-mcp-server\dist\index.js" --target node --format cjs
    if ($LASTEXITCODE -ne 0) { throw "File memory MCP server build failed" }

    bun build "$RootDir\packages\pi-agent-server\src\index.ts" --outfile "$RootDir\packages\pi-agent-server\dist\index.js" --target bun --format esm --external koffi
    if ($LASTEXITCODE -ne 0) { throw "Pi agent server build failed" }
} finally {
    Pop-Location
}

$SessionResourceDir = "$ElectronDir\resources\session-mcp-server"
$FileMemoryResourceDir = "$ElectronDir\resources\file-memory-mcp-server"
$PiResourceDir = "$ElectronDir\resources\pi-agent-server"
New-Item -ItemType Directory -Force -Path $SessionResourceDir, $FileMemoryResourceDir, $PiResourceDir | Out-Null

Copy-Item -Force "$RootDir\packages\session-mcp-server\dist\index.js" "$SessionResourceDir\index.js"
Copy-Item -Force "$RootDir\packages\file-memory-mcp-server\dist\index.js" "$FileMemoryResourceDir\index.js"
Copy-Item -Force "$RootDir\packages\pi-agent-server\dist\index.js" "$PiResourceDir\index.js"

$KoffiSource = "$RootDir\node_modules\koffi"
if (-not (Test-Path $KoffiSource)) {
    Write-Host "WARNING: koffi not found in node_modules. Pi SDK sessions may not work." -ForegroundColor Yellow
} else {
    $KoffiDest = "$PiResourceDir\node_modules\koffi"
    if (Test-Path $KoffiDest) {
        Remove-Item -Recurse -Force $KoffiDest
    }
    New-Item -ItemType Directory -Force -Path $KoffiDest | Out-Null
    foreach ($entry in @("package.json", "index.js", "indirect.js", "index.d.ts", "lib")) {
        $src = "$KoffiSource\$entry"
        if (Test-Path $src) {
            Copy-Item -Recurse -Force $src "$KoffiDest\"
        }
    }

    $NativeSource = "$KoffiSource\build\koffi\win32_x64"
    $NativeDest = "$KoffiDest\build\koffi\win32_x64"
    if (Test-Path $NativeSource) {
        New-Item -ItemType Directory -Force -Path $NativeDest | Out-Null
        Copy-Item -Recurse -Force "$NativeSource\*" $NativeDest
    } else {
        Write-Host "WARNING: koffi win32_x64 native binary not found." -ForegroundColor Yellow
    }
}

# 6. Build Electron app
Write-Host "Building Electron app..."

# Build main process with OAuth credentials
Write-Host "  Building main process..."
$MainArgs = @(
    "apps/electron/src/main/index.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=apps/electron/dist/main.cjs",
    "--external:electron",
    # SDK 0.3.x is pure ESM and calls createRequire(import.meta.url) at module init.
    # esbuild's CJS bundling leaves import.meta.url undefined for inlined ESM, crashing
    # the app on load (ERR_INVALID_ARG_VALUE). Externalize it so Node loads it natively
    # as ESM — the SDK core is staged into the app's node_modules above (step 4).
    # Must stay in sync with package.json build:main and scripts/electron-dev.ts.
    "--external:@anthropic-ai/claude-agent-sdk"
)
# Add OAuth defines if env vars are set
if ($env:GOOGLE_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_ID=`"'$env:GOOGLE_OAUTH_CLIENT_ID'`""
}
if ($env:GOOGLE_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.GOOGLE_OAUTH_CLIENT_SECRET=`"'$env:GOOGLE_OAUTH_CLIENT_SECRET'`""
}
if ($env:SLACK_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_ID=`"'$env:SLACK_OAUTH_CLIENT_ID'`""
}
if ($env:SLACK_OAUTH_CLIENT_SECRET) {
    $MainArgs += "--define:process.env.SLACK_OAUTH_CLIENT_SECRET=`"'$env:SLACK_OAUTH_CLIENT_SECRET'`""
}
if ($env:MICROSOFT_OAUTH_CLIENT_ID) {
    $MainArgs += "--define:process.env.MICROSOFT_OAUTH_CLIENT_ID=`"'$env:MICROSOFT_OAUTH_CLIENT_ID'`""
}
Push-Location $RootDir
try {
    & npx esbuild @MainArgs
    if ($LASTEXITCODE -ne 0) { throw "Main process build failed" }
} finally {
    Pop-Location
}

# Build preload
Write-Host "  Building preload..."
Push-Location $RootDir
try {
    bun run electron:build:preload
    if ($LASTEXITCODE -ne 0) { throw "Preload build failed" }
} finally {
    Pop-Location
}

# Build renderer (frontend)
Write-Host "  Building renderer (frontend)..."
Push-Location $RootDir
try {
    # Clean previous renderer build
    $RendererDir = "$ElectronDir\dist\renderer"
    if (Test-Path $RendererDir) { Remove-Item -Recurse -Force $RendererDir }

    # Run vite build
    npx vite build --config apps/electron/vite.config.ts
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed" }

    # Verify renderer was built
    if (-not (Test-Path "$RendererDir\index.html")) {
        throw "Renderer build verification failed: index.html not found"
    }
    Write-Host "  Renderer build verified: $RendererDir" -ForegroundColor Green
} finally {
    Pop-Location
}

# Copy all resources and bundled assets using the shared script.
# Single source of truth — matches Mac/Linux build (bun run build:copy).
# Copies: resources (icons, DMG bg), docs, tool-icons, themes, permissions, config-defaults.
Write-Host "  Copying resources and bundled assets..."
Push-Location $ElectronDir
try {
    bun scripts/copy-assets.ts
    if ($LASTEXITCODE -ne 0) { throw "Asset copy failed" }
    Write-Host "  Assets copied" -ForegroundColor Green
} finally {
    Pop-Location
}

# 7. Package with electron-builder
Write-Host "Packaging app with electron-builder..."

# Debug: Show bun.exe file info
Write-Host ""
Write-Host "=== Debug: bun.exe File Info ===" -ForegroundColor Magenta
$BunExe = "$ElectronDir\vendor\bun\bun.exe"
if (Test-Path $BunExe) {
    $fileInfo = Get-Item $BunExe
    Write-Host "Path: $($fileInfo.FullName)"
    Write-Host "Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB"
    Write-Host "Created: $($fileInfo.CreationTime)"
    Write-Host "Modified: $($fileInfo.LastWriteTime)"
    Write-Host "Attributes: $($fileInfo.Attributes)"

    # Check Zone.Identifier (Mark of the Web)
    $zoneFile = "$BunExe`:Zone.Identifier"
    if (Test-Path $zoneFile -ErrorAction SilentlyContinue) {
        Write-Host "Zone.Identifier: EXISTS (file may be blocked)" -ForegroundColor Yellow
    } else {
        Write-Host "Zone.Identifier: None (file is unblocked)"
    }

    # Check file hash
    $hash = (Get-FileHash $BunExe -Algorithm SHA256).Hash
    Write-Host "SHA256: $hash"
} else {
    Write-Host "ERROR: bun.exe not found at $BunExe" -ForegroundColor Red
}

# Debug: List vendor directory contents
Write-Host ""
Write-Host "=== Debug: vendor/bun Directory ===" -ForegroundColor Magenta
Get-ChildItem "$ElectronDir\vendor\bun" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  $($_.Name) - $($_.Length) bytes"
}

# Debug: Check for processes that might have files open
Write-Host ""
Write-Host "=== Debug: Potentially Relevant Processes ===" -ForegroundColor Magenta
$relevantProcesses = Get-Process | Where-Object {
    $_.ProcessName -match 'node|npm|bun|electron|defender|antimalware|mpcmdrun'
} | Select-Object ProcessName, Id, CPU, WorkingSet64
if ($relevantProcesses) {
    $relevantProcesses | ForEach-Object {
        Write-Host "  $($_.ProcessName) (PID: $($_.Id)) - Memory: $([math]::Round($_.WorkingSet64 / 1MB, 1)) MB"
    }
} else {
    Write-Host "  No relevant processes found"
}
Write-Host ""

# NOTE: bun.exe is now copied via extraResources in electron-builder.yml
# This avoids EBUSY errors from the npm node module collector.
# See electron-builder.yml for details.

# Verify bun.exe is accessible (not locked by another process)
Write-Host "  Verifying $BunExe is accessible..."
$retryCount = 0
$maxRetries = 6
while ($retryCount -lt $maxRetries) {
    try {
        # Try to open the file exclusively to verify no other process has it locked
        $stream = [System.IO.File]::Open($BunExe, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        $stream.Close()
        $stream.Dispose()
        Write-Host "  File is accessible" -ForegroundColor Green
        break
    } catch {
        $retryCount++
        if ($retryCount -ge $maxRetries) {
            Write-Host "  WARNING: File may be locked after $maxRetries attempts, proceeding anyway..." -ForegroundColor Yellow
        } else {
            Write-Host "  File locked, waiting 5 seconds (attempt $retryCount/$maxRetries)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
}

# Force garbage collection to release any managed file handles
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

# Run electron-builder with retry logic for EBUSY errors
Push-Location $ElectronDir
$maxBuilderRetries = 3
$builderRetry = 0
$builderSuccess = $false

while (-not $builderSuccess -and $builderRetry -lt $maxBuilderRetries) {
    $builderRetry++
    Write-Host "  electron-builder attempt $builderRetry of $maxBuilderRetries..." -ForegroundColor Cyan

    # Clean release directory before each attempt to avoid stale files
    if (Test-Path "$ElectronDir\release") {
        Write-Host "  Cleaning release directory before attempt..."
        Remove-Item -Recurse -Force "$ElectronDir\release" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    npx electron-builder --win --x64 2>&1 | Tee-Object -Variable builderOutput

    if ($LASTEXITCODE -eq 0) {
        $builderSuccess = $true
        Write-Host "  electron-builder succeeded on attempt $builderRetry" -ForegroundColor Green
    } else {
        Write-Host "  electron-builder failed with exit code $LASTEXITCODE" -ForegroundColor Yellow

        if ($builderRetry -lt $maxBuilderRetries) {
            Write-Host "  Waiting 10 seconds before retry..." -ForegroundColor Yellow

            # Kill any processes that might be holding file locks
            Get-Process -Name 'node', 'npm' -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "    Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }

            Start-Sleep -Seconds 10
        }
    }
}

Pop-Location

if (-not $builderSuccess) {
    throw "electron-builder failed after $maxBuilderRetries attempts"
}

# 8. Verify the installer was built
$InstallerPath = Get-ChildItem -Path "$ElectronDir\release" -Filter "*.exe" | Select-Object -First 1

if (-not $InstallerPath) {
    Write-Host "ERROR: Installer not found in $ElectronDir\release" -ForegroundColor Red
    Write-Host "Contents of release directory:"
    Get-ChildItem "$ElectronDir\release"
    exit 1
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "Installer: $($InstallerPath.FullName)"
Write-Host "Size: $([math]::Round($InstallerPath.Length / 1MB, 2)) MB"
