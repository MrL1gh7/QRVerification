$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".tools\demo-processes.json"

if (-not (Test-Path $pidFile)) {
  Write-Output "No demo process file found."
  return
}

$state = Get-Content $pidFile | ConvertFrom-Json

foreach ($pid in @($state.serverPid, $state.ngrokPid)) {
  if ($pid) {
    $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $pid -Force
      Write-Output "Stopped PID $pid"
    }
  }
}

Remove-Item $pidFile -Force
Write-Output "Demo stopped."
