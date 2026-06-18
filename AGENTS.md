# Agent Playbook

This is a local-first portfolio review app. The frontend is React + Vite, and `server.mjs` serves the built app plus local API routes for CSV/JSON persistence, live price lookup, and logo caching.

## Prime Directive

Help the user run or improve the app without taking ownership of their portfolio data.

- Do not edit `data/positions.csv`, `data/settings.json`, or `data/performance.csv` unless the user explicitly asks.
- Do not commit `node_modules/` or `dist/`.
- Prefer small, reviewable changes with `npm run check` passing.
- When a local server is started, report the exact URL and port.

## Key Files

- `package.json`: scripts and dependencies
- `server.mjs`: local server and API routes
- `src/`: React app
- `data/`: local portfolio data
- `.github/workflows/ci.yml`: GitHub Actions validation
- `README.md`: user-facing overview

## Run The App

From the repository root:

```bash
npm run local
```

Expected URL:

```text
http://127.0.0.1:8787
```

`npm run local` installs dependencies, builds the frontend, and starts the local server.

## If Node Or npm Is Missing

Help the user install Node.js LTS, then retry.

Windows, if `winget` is available:

```powershell
winget install OpenJS.NodeJS.LTS
```

macOS, if Homebrew is available:

```bash
brew install node
```

Fallback download:

```text
https://nodejs.org/
```

After installation, verify:

```bash
node --version
npm --version
```

The user may need to reopen Claude Code or their terminal before those commands are available.

## If Port 8787 Is Busy

If the existing process is an old server for this project, stop it and rerun `npm run local`.

Otherwise use another port.

Windows PowerShell:

```powershell
$env:PORT=8788
npm run local
```

macOS/Linux:

```bash
PORT=8788 npm run local
```

Report the new URL, for example:

```text
http://127.0.0.1:8788
```

## Change Validation

Before opening or updating a PR:

```bash
npm run check
```

This runs:

- ESLint
- TypeScript typecheck
- production build

For install/build validation without starting the long-running server:

```bash
npm run setup
```

## Smoke Test Checklist

After setup or code changes:

- `npm run check` passes for code changes.
- The local server starts without port errors.
- `/` returns `200` and includes the React root.
- `/api/portfolio` returns `200` JSON.
- If browser automation is available, open the local URL and confirm the dashboard renders.
- Final response includes the local URL, changed port if any, validation run, and any unresolved issue.
