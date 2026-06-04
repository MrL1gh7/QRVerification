param(
  [int]$Port = 3000,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root ".tools"
$localNodeDir = Join-Path $toolsDir "node-v22.14.0-win-x64"
$localNode = Join-Path $localNodeDir "node.exe"
$localNpm = Join-Path $localNodeDir "npm.cmd"
$envFile = Join-Path $root ".env"
$envExample = Join-Path $root ".env.example"

function Resolve-Executable {
  param(
    [string]$LocalPath,
    [string[]]$Names,
    [string]$InstallHint
  )

  if ($LocalPath -and (Test-Path $LocalPath)) {
    return (Resolve-Path $LocalPath).Path
  }

  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw "$($Names -join '/') was not found. $InstallHint"
}

Set-Location $root

if (-not (Test-Path $toolsDir)) {
  New-Item -ItemType Directory -Path $toolsDir | Out-Null
}

$node = Resolve-Executable `
  -LocalPath $localNode `
  -Names @("node.exe", "node") `
  -InstallHint "Install Node.js 22 LTS: https://nodejs.org/"

$npm = Resolve-Executable `
  -LocalPath $localNpm `
  -Names @("npm.cmd", "npm") `
  -InstallHint "Install Node.js 22 LTS with npm: https://nodejs.org/"

$nodeMajor = [int]((& $node -p "process.versions.node.split('.')[0]") -replace '\D', '')
if ($nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required. Current Node: $(& $node -v)"
}

if (-not (Test-Path $envFile)) {
  Copy-Item -Path $envExample -Destination $envFile
  Write-Output "Created .env from .env.example"
}

if ($Install -or -not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Output "Installing npm dependencies..."
  & $npm install
}

$env:PORT = "$Port"
$env:PUBLIC_BASE_URL = "http://localhost:$Port"

Write-Output ""
Write-Output "Local demo is starting..."
Write-Output "Admin Web App: http://localhost:$Port/app/qr?dev_username=Light_epoH"
Write-Output "API docs:      http://localhost:$Port/docs"
Write-Output "Healthcheck:   http://localhost:$Port/healthz"
Write-Output ""
Write-Output "Stop: press Ctrl+C in this terminal."
Write-Output ""

& $npm run dev
