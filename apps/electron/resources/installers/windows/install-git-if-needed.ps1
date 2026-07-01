param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$BundledVersion
)

$ErrorActionPreference = "Stop"

function Convert-ToGitVersion {
    param([string]$Text)
    if (-not $Text) { return $null }
    $match = [regex]::Match($Text, '(\d+)\.(\d+)\.(\d+)')
    if (-not $match.Success) { return $null }
    return [Version]::new(
        [int]$match.Groups[1].Value,
        [int]$match.Groups[2].Value,
        [int]$match.Groups[3].Value
    )
}

function Add-GitVersionCandidate {
    param(
        [System.Collections.Generic.List[Version]]$Versions,
        [string]$Text
    )
    $version = Convert-ToGitVersion $Text
    if ($version -ne $null) {
        $Versions.Add($version)
    }
}

function Get-InstalledGitVersion {
    $versions = [System.Collections.Generic.List[Version]]::new()

    $registryKeys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Git_is1'
    )

    foreach ($key in $registryKeys) {
        try {
            $item = Get-ItemProperty -Path $key -ErrorAction Stop
            Add-GitVersionCandidate $versions $item.DisplayVersion
            Add-GitVersionCandidate $versions $item.DisplayName
        } catch {
            continue
        }
    }

    $candidatePaths = @()
    try {
        $cmd = Get-Command git.exe -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) { $candidatePaths += $cmd.Source }
    } catch {}

    $candidatePaths += @(
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:ProgramFiles\Git\bin\git.exe",
        "${env:ProgramFiles(x86)}\Git\bin\git.exe"
    )

    foreach ($gitExe in ($candidatePaths | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $gitExe)) { continue }
        try {
            $output = & $gitExe --version 2>$null
            Add-GitVersionCandidate $versions $output
        } catch {
            continue
        }
    }

    if ($versions.Count -eq 0) { return $null }
    return $versions | Sort-Object -Descending | Select-Object -First 1
}

function Add-DirectoryToUserPathFront {
    param([string]$Directory)
    if (-not $Directory -or -not (Test-Path -LiteralPath $Directory)) { return }

    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($current) {
        $parts = $current -split ';' | Where-Object { $_ -and $_.Trim() }
    }

    $normalizedDirectory = $Directory.TrimEnd('\')
    $remaining = $parts | Where-Object {
        $_.TrimEnd('\').ToLowerInvariant() -ne $normalizedDirectory.ToLowerInvariant()
    }

    $next = @($normalizedDirectory) + $remaining
    [Environment]::SetEnvironmentVariable('Path', ($next -join ';'), 'User')
    $env:Path = "$normalizedDirectory;$env:Path"
}

function Notify-EnvironmentChanged {
    $signature = @'
using System;
using System.Runtime.InteropServices;
public static class NativeMethods {
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        UIntPtr wParam,
        string lParam,
        uint fuFlags,
        uint uTimeout,
        out UIntPtr lpdwResult);
}
'@
    try {
        if (-not ('NativeMethods' -as [type])) {
            Add-Type $signature
        }
        $result = [UIntPtr]::Zero
        [NativeMethods]::SendMessageTimeout(
            [IntPtr]0xffff,
            0x001A,
            [UIntPtr]::Zero,
            'Environment',
            0x0002,
            5000,
            [ref]$result
        ) | Out-Null
    } catch {}
}

try {
    if (-not (Test-Path -LiteralPath $InstallerPath)) {
        exit 0
    }

    $bundled = Convert-ToGitVersion $BundledVersion
    if ($bundled -eq $null) {
        exit 0
    }

    $installed = Get-InstalledGitVersion
    if ($installed -ne $null -and $installed -ge $bundled) {
        exit 0
    }

    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\Git'
    $logPath = Join-Path $env:TEMP 'agent-pi-git-install.log'
    $arguments = @(
        '/VERYSILENT',
        '/NORESTART',
        '/NOCANCEL',
        '/SP-',
        '/CLOSEAPPLICATIONS',
        '/RESTARTAPPLICATIONS',
        '/CURRENTUSER',
        "/DIR=`"$installDir`"",
        '/COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"',
        "/LOG=`"$logPath`""
    )

    $process = Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        exit 0
    }

    Add-DirectoryToUserPathFront (Join-Path $installDir 'cmd')
    Notify-EnvironmentChanged
} catch {
    exit 0
}

exit 0
