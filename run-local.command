#!/bin/bash
set -e

cd "$(dirname "$0")"

PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}/"

echo ""
echo "Portfolio Review Local"
echo "Project folder: $(pwd)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required before running this app."
  echo ""
  echo "Install Node.js LTS from https://nodejs.org/"
  echo "If macOS blocks this file, Control-click it, choose Open, then confirm."
  echo ""
  read -r -p "Press Return to close "
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found, even though Node.js is installed."
  echo "Reinstall Node.js LTS from https://nodejs.org/ and try again."
  echo ""
  read -r -p "Press Return to close "
  exit 1
fi

echo "Installing dependencies, building the app, and starting the local server."
echo "When startup finishes, open: ${URL}"
echo ""
echo "If port ${PORT} is busy, close the old app window or run this with another PORT value."
echo ""

npm run local
