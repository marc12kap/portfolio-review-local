$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required before running this local portfolio app."
  Write-Host "Install Node.js LTS from https://nodejs.org, then run this script again."
  exit 1
}

npm install
npm run build
npm start
