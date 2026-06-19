$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$Port = if ($env:PORT) { $env:PORT } else { "8787" }
$Url = "http://127.0.0.1:$Port/"

Write-Host ""
Write-Host "Portfolio Review Local"
Write-Host "Project folder: $ProjectRoot"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required before running this app."
  Write-Host ""
  Write-Host "Install Node.js LTS from https://nodejs.org/"
  Write-Host "Then close this window, reopen it, and run this file again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm was not found, even though Node.js is installed."
  Write-Host "Reinstall Node.js LTS from https://nodejs.org/ and try again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "Installing dependencies, building the app, and starting the local server."
Write-Host "When startup finishes, open: $Url"
Write-Host ""
Write-Host "If port $Port is busy, close the old app window or run this with another PORT value."
Write-Host ""

npm run local
