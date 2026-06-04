$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".tools\demo-processes.json"

if (-not (Test-Path $pidFile)) {
  Write-Output "No demo process file found."
  return
}

$state = Get-Content $pidFile | ConvertFrom-Json

foreach ($processId in @($state.serverPid, $state.ngrokPid)) {
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force
      Write-Output "Stopped PID $processId"
    }
  }
}

Remove-Item $pidFile -Force
Write-Output "Demo stopped."
