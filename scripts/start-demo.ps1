param(
  [int]$Port = 3000,
  [switch]$ConfigureTelegram,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root ".tools"
$localNodeDir = Join-Path $toolsDir "node-v22.14.0-win-x64"
$localNode = Join-Path $localNodeDir "node.exe"
$localNpm = Join-Path $localNodeDir "npm.cmd"
$localNgrok = Join-Path $toolsDir "ngrok\ngrok.exe"
$ngrokConfig = Join-Path $toolsDir "ngrok.yml"
$envFile = Join-Path $root ".env"
$envExample = Join-Path $root ".env.example"
$pidFile = Join-Path $toolsDir "demo-processes.json"
$serverOut = Join-Path $toolsDir "server.out.log"
$serverErr = Join-Path $toolsDir "server.err.log"
$ngrokOut = Join-Path $toolsDir "ngrok.out.log"
$ngrokErr = Join-Path $toolsDir "ngrok.err.log"

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

$ngrok = Resolve-Executable `
  -LocalPath $localNgrok `
  -Names @("ngrok.exe", "ngrok") `
  -InstallHint "Install ngrok and run: ngrok config add-authtoken <token>"

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

if (Test-Path $pidFile) {
  & (Join-Path $PSScriptRoot "stop-demo.ps1") | Out-Null
}

Write-Output "Building backend..."
& $npm run build

$ngrokArgs = @("http", "$Port", "--log", "stdout")
if (Test-Path $ngrokConfig) {
  $ngrokArgs += @("--config", $ngrokConfig)
}

$ngrokProcess = Start-Process `
  -FilePath $ngrok `
  -ArgumentList $ngrokArgs `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $ngrokOut `
  -RedirectStandardError $ngrokErr `
  -PassThru

$publicUrl = $null
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $tunnels = (Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels").tunnels
    $publicUrl = ($tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
    if ($publicUrl) { break }
  } catch {
    Start-Sleep -Milliseconds 250
  }
}

if (-not $publicUrl) {
  throw "ngrok did not expose an HTTPS URL. Check $ngrokOut and $ngrokErr"
}

$envLines = Get-Content $envFile
$hasPublicBaseUrl = $false
$envLines = $envLines | ForEach-Object {
  if ($_ -like "PUBLIC_BASE_URL=*") {
    $hasPublicBaseUrl = $true
    "PUBLIC_BASE_URL=$publicUrl"
  } else {
    $_
  }
}
if (-not $hasPublicBaseUrl) {
  $envLines += "PUBLIC_BASE_URL=$publicUrl"
}
Set-Content -Encoding utf8 -Path $envFile -Value $envLines

$env:PORT = "$Port"
$env:PUBLIC_BASE_URL = $publicUrl

$serverProcess = Start-Process `
  -FilePath $node `
  -ArgumentList "dist/server.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $serverOut `
  -RedirectStandardError $serverErr `
  -PassThru

$backendReady = $false
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" | Out-Null
    $backendReady = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $backendReady) {
  throw "Backend did not become ready on http://127.0.0.1:$Port/healthz. Check $serverOut and $serverErr"
}

@{
  serverPid = $serverProcess.Id
  ngrokPid = $ngrokProcess.Id
  publicUrl = $publicUrl
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Encoding utf8 -Path $pidFile

if ($ConfigureTelegram) {
  & $npm run telegram:configure
}

Write-Output ""
Write-Output "Telegram demo is running"
Write-Output "Server:  http://127.0.0.1:$Port"
Write-Output "Public:  $publicUrl"
Write-Output "Web App: $publicUrl/app/qr"
Write-Output "Scanner: $publicUrl/app/scanner"
Write-Output ""
Write-Output "Stop: powershell -ExecutionPolicy Bypass -File .\scripts\stop-demo.ps1"
