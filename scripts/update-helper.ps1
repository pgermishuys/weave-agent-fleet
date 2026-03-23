$ErrorActionPreference = 'Stop'

$statePath = $env:WEAVE_UPDATE_STATE_PATH
$channel = if ($env:WEAVE_UPDATE_CHANNEL) { $env:WEAVE_UPDATE_CHANNEL } else { 'stable' }
$launcherPath = $env:WEAVE_UPDATE_LAUNCHER_PATH
$port = if ($env:WEAVE_UPDATE_PORT) { $env:WEAVE_UPDATE_PORT } else { '3000' }
$hostname = if ($env:WEAVE_UPDATE_HOSTNAME) { $env:WEAVE_UPDATE_HOSTNAME } else { '0.0.0.0' }
$startedAt = $env:WEAVE_UPDATE_STARTED_AT

if (-not $statePath) {
  throw 'WEAVE_UPDATE_STATE_PATH is required'
}

if (-not $launcherPath) {
  throw 'WEAVE_UPDATE_LAUNCHER_PATH is required'
}

function Write-State {
  param(
    [Parameter(Mandatory = $true)][string]$State,
    [string]$ErrorMessage
  )

  $payload = [ordered]@{
    state = $State
    channel = $channel
    targetVersion = $null
    error = if ($ErrorMessage) { $ErrorMessage } else { $null }
    startedAt = if ($startedAt) { $startedAt } else { $null }
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    reconnectHint = 'Server may disconnect while update installs.'
  }

  $parent = Split-Path -Parent $statePath
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $json = $payload | ConvertTo-Json -Depth 5
  Set-Content -Path $statePath -Value $json -Encoding utf8
}

Write-State -State 'installing'

try {
  $env:WEAVE_UPDATE_CHANNEL = $channel
  $env:WEAVE_HOSTNAME = $hostname
  $updateProc = Start-Process -FilePath $launcherPath -ArgumentList 'update' -Wait -PassThru -NoNewWindow

  if ($updateProc.ExitCode -ne 0) {
    throw "Standalone update command failed with exit code $($updateProc.ExitCode)."
  }

  Write-State -State 'restarting'

  $env:WEAVE_HOSTNAME = $hostname
  Start-Process -FilePath $launcherPath -ArgumentList @('--port', $port) -WindowStyle Hidden | Out-Null

  Write-State -State 'completed'
}
catch {
  Write-State -State 'failed' -ErrorMessage $_.Exception.Message
  throw
}
