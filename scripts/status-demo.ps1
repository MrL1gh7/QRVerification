$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".tools\demo-processes.json"

if (Test-Path $pidFile) {
  $state = Get-Content $pidFile | ConvertFrom-Json
  Write-Output "Public URL: $($state.publicUrl)"
  Write-Output "Server PID: $($state.serverPid)"
  Write-Output "ngrok PID: $($state.ngrokPid)"
} else {
  Write-Output "No demo process file found."
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/healthz"
  Write-Output "Backend: $($health.status)"
} catch {
  Write-Output "Backend: unavailable"
}

try {
  $tunnels = (Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels").tunnels
  $publicUrl = ($tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
  if ($publicUrl) {
    Write-Output "ngrok: $publicUrl"
  } else {
    Write-Output "ngrok: no HTTPS tunnel"
  }
} catch {
  Write-Output "ngrok: unavailable"
}
