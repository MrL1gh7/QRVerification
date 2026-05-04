param(
  [int]$Port = 3000,
  [switch]$ConfigureTelegram
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root ".tools\node-v22.14.0-win-x64\node.exe"
$npm = Join-Path $root ".tools\node-v22.14.0-win-x64\npm.cmd"
$ngrok = Join-Path $root ".tools\ngrok\ngrok.exe"
$ngrokConfig = Join-Path $root ".tools\ngrok.yml"
$envFile = Join-Path $root ".env"
$pidFile = Join-Path $root ".tools\demo-processes.json"
$serverOut = Join-Path $root ".tools\server.out.log"
$serverErr = Join-Path $root ".tools\server.err.log"
$ngrokOut = Join-Path $root ".tools\ngrok.out.log"
$ngrokErr = Join-Path $root ".tools\ngrok.err.log"

Set-Location $root

if (-not (Test-Path $node)) { throw "Portable Node.js was not found: $node" }
if (-not (Test-Path $ngrok)) { throw "ngrok was not found: $ngrok" }
if (-not (Test-Path $ngrokConfig)) { throw "ngrok config was not found. Run: .tools\ngrok\ngrok.exe config add-authtoken <token> --config .tools\ngrok.yml" }
if (-not (Test-Path $envFile)) { throw ".env was not found" }
if (-not (Test-Path (Join-Path $root "dist\server.js"))) { & $npm run build }

if (Test-Path $pidFile) {
  & (Join-Path $PSScriptRoot "stop-demo.ps1") | Out-Null
}

$ngrokProcess = Start-Process `
  -FilePath $ngrok `
  -ArgumentList @("http", "$Port", "--config", $ngrokConfig, "--log", "stdout") `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $ngrokOut `
  -RedirectStandardError $ngrokErr `
  -PassThru

$publicUrl = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
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
  throw "ngrok tunnel did not expose an HTTPS URL. See .tools\ngrok.out.log and .tools\ngrok.err.log"
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
Set-Content -Path $envFile -Value $envLines

$serverProcess = Start-Process `
  -FilePath $node `
  -ArgumentList "dist/server.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $serverOut `
  -RedirectStandardError $serverErr `
  -PassThru

Start-Sleep -Seconds 2
Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" | Out-Null

@{
  serverPid = $serverProcess.Id
  ngrokPid = $ngrokProcess.Id
  publicUrl = $publicUrl
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Path $pidFile

if ($ConfigureTelegram) {
  $env:Path = (Split-Path $node -Parent) + ";" + $env:Path
  & $npm run telegram:configure
}

Write-Output "Demo is running"
Write-Output "Server: http://127.0.0.1:$Port"
Write-Output "Public: $publicUrl"
Write-Output "QR: $publicUrl/app/qr"
Write-Output "Scanner: $publicUrl/app/scanner"
