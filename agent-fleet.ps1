# install.ps1 — Weave Agent Fleet installer for Windows
# Usage: irm https://github.com/pgermishuys/weave-agent-fleet/releases/latest/download/install.ps1 | iex
#
# Environment variables:
#   WEAVE_VERSION      — Install a specific version (e.g., "0.1.0"). Default: latest.
#   WEAVE_INSTALL_DIR  — Installation directory. Default: %LOCALAPPDATA%\weave\fleet

$ErrorActionPreference = 'Stop'

$Repo = "pgermishuys/weave-agent-fleet"
$DefaultInstallDir = Join-Path $env:LOCALAPPDATA "weave\fleet"
$InstallDir = if ($env:WEAVE_INSTALL_DIR) { $env:WEAVE_INSTALL_DIR } else { $DefaultInstallDir }

# --- Helpers ---

function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-ErrorAndExit {
    param([string]$Message)
    Write-Host "Error: $Message" -ForegroundColor Red
    exit 1
}

# --- Detect architecture ---

function Get-TargetArch {
    $arch = $env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        "AMD64" { return "x64" }
        "ARM64" {
            Write-ErrorAndExit "Windows ARM64 is not yet supported. See: https://github.com/$Repo/issues"
        }
        default {
            Write-ErrorAndExit "Unsupported architecture: $arch. Only x64 is supported."
        }
    }
}

# --- Detect version ---

function Get-LatestVersion {
    if ($env:WEAVE_VERSION) {
        Write-Info "Using specified version: v$($env:WEAVE_VERSION)"
        return $env:WEAVE_VERSION
    }

    Write-Info "Fetching latest version..."
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing
        $tag = $release.tag_name
        $version = $tag -replace '^v', ''
        if (-not $version) {
            Write-ErrorAndExit "Could not determine latest version from GitHub API."
        }
        Write-Info "Latest version: v$version"
        return $version
    }
    catch {
        Write-ErrorAndExit "Failed to fetch latest release from GitHub. Check your internet connection.`n$($_.Exception.Message)"
    }
}

# --- Verify checksum ---

function Get-FileSHA256 {
    param([string]$FilePath)

    # Get-FileHash requires PowerShell 4.0+; fall back to .NET for older versions
    if (Get-Command "Get-FileHash" -ErrorAction SilentlyContinue) {
        return (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($FilePath)
        try {
            $hashBytes = $sha256.ComputeHash($stream)
            return [BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
        }
        finally {
            $stream.Close()
        }
    }
    finally {
        $sha256.Dispose()
    }
}

function Test-Checksum {
    param(
        [string]$FilePath,
        [string]$ExpectedHash
    )

    $actualHash = Get-FileSHA256 -FilePath $FilePath
    $expected = $ExpectedHash.ToLower()

    if ($actualHash -ne $expected) {
        Write-ErrorAndExit "Checksum verification failed!`n  Expected: $expected`n  Actual:   $actualHash`nThe download may be corrupted. Please try again."
    }
}

# --- Extract zip ---

function Expand-ZipFile {
    param(
        [string]$ZipPath,
        [string]$DestinationPath
    )

    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null

    # Expand-Archive requires PowerShell 5.0+; fall back to .NET / COM for older versions
    if (Get-Command "Expand-Archive" -ErrorAction SilentlyContinue) {
        Expand-Archive -Path $ZipPath -DestinationPath $DestinationPath -Force
        return
    }

    # Try .NET 4.5+ ZipFile class
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestinationPath)
        return
    }
    catch {
        # Fall through to COM Shell.Application
    }

    # Last resort: COM Shell.Application (works on all Windows versions)
    $shell = New-Object -ComObject Shell.Application
    $zip = $shell.NameSpace((Resolve-Path $ZipPath).Path)
    $dest = $shell.NameSpace((Resolve-Path $DestinationPath).Path)
    if (-not $zip -or -not $dest) {
        Write-ErrorAndExit "Failed to extract archive. Could not open zip file or destination."
    }
    # 0x14 = overwrite + no progress dialog
    $dest.CopyHere($zip.Items(), 0x14)
}

# --- Add to PATH ---

function Add-ToUserPath {
    param([string]$BinDir)

    $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $currentPath) {
        $currentPath = ""
    }

    # Check if already in PATH
    $paths = $currentPath -split ';' | Where-Object { $_ -ne '' }
    $normalizedBinDir = $BinDir.TrimEnd('\')
    $alreadyPresent = $paths | Where-Object { $_.TrimEnd('\') -eq $normalizedBinDir }

    if ($alreadyPresent) {
        return
    }

    $newPath = "$BinDir;$currentPath"
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Info "Added $BinDir to user PATH."
}

# --- Main ---

function Main {
    Write-Host ""
    Write-Info "Weave Agent Fleet Installer (Windows)"
    Write-Host ""

    $arch = Get-TargetArch
    $target = "windows-$arch"
    $version = Get-LatestVersion

    $zipName = "weave-fleet-v$version-$target.zip"
    $downloadUrl = "https://github.com/$Repo/releases/download/v$version/$zipName"
    $checksumsUrl = "https://github.com/$Repo/releases/download/v$version/checksums.txt"

    # Create temp directory
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "weave-fleet-install-$([System.Guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    try {
        # Download zip archive
        $zipPath = Join-Path $tmpDir $zipName
        Write-Info "Downloading $zipName..."
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
        }
        catch {
            Write-ErrorAndExit "Failed to download $zipName. Check that a release exists for your platform ($target).`n$($_.Exception.Message)"
        }

        # Download and verify checksum
        Write-Info "Verifying checksum..."
        $checksumsPath = Join-Path $tmpDir "checksums.txt"
        try {
            Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath -UseBasicParsing
            $checksumLine = Get-Content $checksumsPath | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
            if ($checksumLine) {
                $expectedHash = ($checksumLine -split '\s+')[0]
                Test-Checksum -FilePath $zipPath -ExpectedHash $expectedHash
                Write-Success "Checksum verified."
            }
            else {
                Write-Warn "Warning: Checksum for $zipName not found in checksums.txt. Skipping verification."
            }
        }
        catch [System.Net.WebException] {
            Write-Warn "Warning: Could not download checksums.txt. Skipping verification."
        }

        # Remove existing installation
        if (Test-Path $InstallDir) {
            Write-Info "Removing existing installation at $InstallDir..."
            Remove-Item -Recurse -Force $InstallDir
        }

        # Extract zip
        Write-Info "Installing to $InstallDir..."
        $extractDir = Join-Path $tmpDir "extracted"
        Expand-ZipFile -ZipPath $zipPath -DestinationPath $extractDir

        # The zip extracts to a named directory — find it
        $innerDir = Get-ChildItem -Path $extractDir -Directory | Where-Object { $_.Name -match "^weave-fleet-" } | Select-Object -First 1

        if ($innerDir) {
            # Move contents to install dir
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
            Copy-Item -Path "$($innerDir.FullName)\*" -Destination $InstallDir -Recurse -Force
        }
        else {
            # Fallback: contents are directly in extract dir
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
            Copy-Item -Path "$extractDir\*" -Destination $InstallDir -Recurse -Force
        }

        # Add to PATH
        $binDir = Join-Path $InstallDir "bin"
        Add-ToUserPath -BinDir $binDir

        Write-Host ""
        Write-Success "Weave Fleet v$version installed successfully!"
        Write-Host ""
        Write-Host "  Install location: $InstallDir"
        Write-Host "  Binary:           $binDir\weave-fleet.cmd"
        Write-Host ""

        # Check if opencode is available
        $opencodeFound = Get-Command "opencode" -ErrorAction SilentlyContinue
        if (-not $opencodeFound) {
            Write-Warn "Note: OpenCode CLI is required but not found on PATH."
            Write-Host "  Install it from: https://opencode.ai"
            Write-Host ""
        }

        Write-Host "To get started:"
        Write-Host ""
        Write-Host "  1. Open a new terminal (PATH changes require a new session)"
        Write-Host "  2. Run: weave-fleet"
        Write-Host "  3. Open http://localhost:3000 in your browser"
        Write-Host ""
    }
    finally {
        # Clean up temp directory
        if (Test-Path $tmpDir) {
            Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        }
    }
}

Main
