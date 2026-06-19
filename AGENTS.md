# Agent Playbook

This is a local-first portfolio review app. The frontend is React + Vite, and `server.mjs` serves the built app plus local API routes for CSV/JSON persistence, live price lookup, and logo caching.

## Prime Directive

Help the user run or improve the app without taking ownership of their portfolio data.

- Do not edit `data/positions.csv`, `data/settings.json`, or `data/performance.csv` unless the user explicitly asks.
- Do not commit `node_modules/`, `dist/`, or local working data under `data/`.
- Treat `demo-data/sample/` as the committed example dataset.
- Prefer small, reviewable changes with `npm run check` passing.
- When a local server is started, report the exact URL and port.

## Key Files

- `package.json`: scripts and dependencies
- `server.mjs`: local server and API routes
- `src/`: React app
- `data/`: ignored local portfolio data created on first run
- `data/backups/`: ignored timestamped backups created before local saves
- `data/source.json`: ignored local metadata that tracks demo versus user-owned data
- `demo-data/sample/`: committed demo defaults used to seed missing local data
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

## Help A User Replace Demo Data

The expected first-time workflow is:

1. Let the user tour the seeded demo portfolio first.
2. When they are ready to build their own portfolio, have them open `Edit Positions`.
3. In `Reset local files`, use `Start Blank` to clear demo rows. This creates timestamped backups
   before replacing local files.
4. Help them add real holdings manually in the editor or convert their existing data into
   `positions.csv`.
5. Make sure each row has a useful `sector` or theme bucket so the allocation views work well.
6. Confirm available cash, beginning book value, performance history, and price badges before they
   rely on the report.

If the user asks for AI-assisted seeding, ask them to paste or attach non-sensitive holdings data
such as ticker, company, shares/contracts, average cost, market value if known, sector/theme, option
type, strike, expiry, and premium. Do not ask for brokerage passwords or account logins.

Keep `data/source.json` aligned with the active data state: demo setup/reset should mark `demo`;
blank setup, import setup, and user saves should mark `user`.

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
- Node test suite
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
