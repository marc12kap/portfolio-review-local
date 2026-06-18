# Agent Setup Instructions

This repository is a local portfolio review app. It uses React + Vite for the frontend and a small Node server in `server.mjs` for local API routes, CSV/JSON persistence, logo caching, and static file serving.

## Goal

Get the app running locally for the user and give them the browser URL.

## Important Files

- `package.json`: project scripts and dependencies
- `server.mjs`: local Node server
- `src/`: React app source
- `data/positions.csv`: local portfolio holdings
- `data/settings.json`: local account settings
- `data/performance.csv`: local performance path
- `README.md`: project overview

Do not edit portfolio data files unless the user asks.

## Standard Setup

From the repository root:

```bash
npm run local
```

The expected URL is:

```text
http://127.0.0.1:8787
```

## If Node Or npm Is Missing

Help the user install Node.js LTS before continuing. First detect the operating system, then choose the safest available installer path.

On Windows, try `winget` if available:

```powershell
winget install OpenJS.NodeJS.LTS
```

On macOS, try Homebrew if available:

```bash
brew install node
```

If a package manager is not available, open or give the user the Node.js LTS download page:

```text
https://nodejs.org/
```

After installation, have the user reopen Claude Code or their terminal if needed. Verify both commands work before continuing:

```bash
node --version
npm --version
```

Then rerun:

```bash
npm run local
```

## If Port 8787 Is Already In Use

First check whether the existing process is an old local server for this same project. If it is, stop that process and rerun:

```bash
npm run local
```

If stopping the old process is not appropriate, run the app on another local port.

On Windows PowerShell:

```powershell
$env:PORT=8788
npm run local
```

On macOS/Linux:

```bash
PORT=8788 npm run local
```

Then give the user:

```text
http://127.0.0.1:8788
```

## Validation

For code changes, run the local validation suite before opening or updating a PR:

```bash
npm run check
```

After starting the server, verify both routes return successfully:

```text
http://127.0.0.1:8787
http://127.0.0.1:8787/api/portfolio
```

If using a different port, validate the same paths on that port.

## User-Facing Summary

When finished, tell the user:

- the local URL to open
- whether dependencies installed successfully
- whether the build passed
- any issue you fixed or could not fix
