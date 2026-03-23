# assemble-standalone.ps1
# Assembles the Next.js standalone output into a complete, runnable distribution.
# Must be run after `next build` with `output: 'standalone'` in next.config.ts.

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Determine standalone directory — Turbopack may nest under the project name
$StandaloneDir = $null

$directServerJs = Join-Path $ProjectRoot ".next\standalone\server.js"
if (Test-Path $directServerJs) {
    $StandaloneDir = Join-Path $ProjectRoot ".next\standalone"
}
else {
    # Find the nested directory (e.g., .next/standalone/weave-agent-fleet/)
    $standaloneBase = Join-Path $ProjectRoot ".next\standalone"
    if (Test-Path $standaloneBase) {
        $nestedDirs = Get-ChildItem -Path $standaloneBase -Directory
        foreach ($dir in $nestedDirs) {
            $nestedServerJs = Join-Path $dir.FullName "server.js"
            if (Test-Path $nestedServerJs) {
                $StandaloneDir = $dir.FullName
                break
            }
        }
    }
}

if (-not $StandaloneDir -or -not (Test-Path (Join-Path $StandaloneDir "server.js"))) {
    Write-Error "standalone server.js not found. Did you run 'next build' with output: 'standalone'?"
    exit 1
}

Write-Host "Standalone directory: $StandaloneDir"

# 1. Copy static assets (required by Next.js standalone mode)
Write-Host "Copying .next/static/ ..."
$staticSrc = Join-Path $ProjectRoot ".next\static"
$staticDst = Join-Path $StandaloneDir ".next\static"
if (Test-Path $staticSrc) {
    New-Item -ItemType Directory -Path $staticDst -Force | Out-Null
    Copy-Item -Path "$staticSrc\*" -Destination $staticDst -Recurse -Force
}

# 2. Copy public assets
$publicSrc = Join-Path $ProjectRoot "public"
if (Test-Path $publicSrc) {
    Write-Host "Copying public/ ..."
    $publicDst = Join-Path $StandaloneDir "public"
    New-Item -ItemType Directory -Path $publicDst -Force | Out-Null
    Copy-Item -Path "$publicSrc\*" -Destination $publicDst -Recurse -Force
}

# 3. Verify native addon for better-sqlite3
$sqliteAddon = Join-Path $StandaloneDir "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
if (-not (Test-Path $sqliteAddon)) {
    Write-Host "Warning: better-sqlite3 native addon missing from standalone output. Copying from node_modules..."
    $srcAddon = Join-Path $ProjectRoot "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
    if (Test-Path $srcAddon) {
        $addonDir = Split-Path -Parent $sqliteAddon
        New-Item -ItemType Directory -Path $addonDir -Force | Out-Null
        Copy-Item -Path $srcAddon -Destination $sqliteAddon -Force
        Write-Host "Copied better-sqlite3 native addon."
    }
    else {
        Write-Error "better-sqlite3 native addon not found in source node_modules either."
        exit 1
    }
}

# 4. Copy CLI script
$cliJs = Join-Path $ProjectRoot "cli.js"
if (Test-Path $cliJs) {
    Write-Host "Copying cli.js ..."
    Copy-Item -Path $cliJs -Destination (Join-Path $StandaloneDir "cli.js") -Force
}
else {
    Write-Host "Warning: cli.js not found. Run 'npm run build:cli' first if you want CLI commands."
}

# 5. Write VERSION file from package.json
$packageJsonPath = Join-Path $ProjectRoot "package.json"
try {
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    $version = $packageJson.version
}
catch {
    $version = "0.0.0"
}
Set-Content -Path (Join-Path $StandaloneDir "VERSION") -Value $version -NoNewline

# 6. Copy standalone update helper templates
$scriptsDst = Join-Path $StandaloneDir "scripts"
New-Item -ItemType Directory -Path $scriptsDst -Force | Out-Null
Copy-Item -Path (Join-Path $ProjectRoot "scripts\update-helper.sh") -Destination (Join-Path $scriptsDst "update-helper.sh") -Force
Copy-Item -Path (Join-Path $ProjectRoot "scripts\update-helper.ps1") -Destination (Join-Path $scriptsDst "update-helper.ps1") -Force

Write-Host "Assembly complete. Standalone directory is ready at: $StandaloneDir"
Write-Host "  Version: $version"
Write-Host "  Test with: node $StandaloneDir\server.js"
