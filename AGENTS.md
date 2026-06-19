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
- `run-local.bat`: Windows double-click launcher
- `run-local.ps1`: Windows PowerShell launcher used by the batch file
- `run-local.command`: macOS double-click launcher
- `AI_AGENT_IMPORT.md`: agent-facing portfolio seeding workflow and prompt
- `server.mjs`: local server and API routes
- `src/`: React app
- `data/`: ignored local portfolio data created on first run
- `data/backups/`: ignored timestamped backups created before local saves
- `data/source.json`: ignored local metadata that tracks demo versus user-owned data
- `data/schema.json`: ignored local metadata that tracks local CSV/JSON schema version
- `demo-data/sample/`: committed demo defaults used to seed missing local data
- `.github/workflows/ci.yml`: GitHub Actions validation
- `README.md`: user-facing overview

## Run The App

Beginner-friendly launchers:

- Windows: double-click `run-local.bat`.
- macOS: double-click `run-local.command`.

From the repository root:

```bash
npm run local
```

Expected URL:

```text
http://127.0.0.1:8787
```

`npm run local` installs dependencies, builds the frontend, and starts the local server.

If a script needs a different port, set `PORT` before running it:

Windows PowerShell:

```powershell
$env:PORT=8788
.\run-local.ps1
```

macOS:

```bash
PORT=8788 ./run-local.command
```

## Help A User Replace Demo Data

The expected first-time workflow is:

1. Let the user tour the seeded demo portfolio first.
2. When they are ready to build their own portfolio, have them open `Edit Positions`.
3. In `Reset local files`, use `Start Blank` to clear demo rows. This creates timestamped backups
   before replacing local files.
4. Help them add real holdings manually in the editor or convert their existing data into
   `positions.csv`.
5. Make sure each row has a useful `sector` or theme bucket so the allocation views work well.
6. Confirm available cash, beginning book value, optional performance history, and price badges
   before they rely on the report.

The report should be treated as a current portfolio snapshot through today's Eastern Time date. Do
not imply the app can reconstruct arbitrary historical holdings unless the user provides and
maintains performance data.

If the user asks for AI-assisted seeding, follow `AI_AGENT_IMPORT.md`. Ask them to paste or attach
non-sensitive holdings data such as ticker, company, shares/contracts, average cost, market value if
known, sector/theme, option type, strike, expiry, and premium. Do not ask for brokerage passwords or
account logins. Summarize assumptions and preview proposed local files before writing anything.

For logos, prefer explicit trusted `logoUrl` values. Use `initials`, `none`, or `no-logo` for
private, ambiguous, stale, or low-confidence holdings so the app shows a clean initials fallback
instead of a polished but wrong logo.

Use `POST /api/import/preview` to validate proposed AI-assisted imports before writing local files.
The endpoint is a dry run and should not create backups, mutate `data/`, or require existing local
portfolio files.

Keep `data/source.json` aligned with the active data state: demo setup/reset should mark `demo`;
blank setup, import setup, and user saves should mark `user`.

## Local Data Migrations

`server.mjs` owns local schema migrations through `migrateLocalDataFiles()`.

When adding or changing local fields:

1. Bump or extend the migration logic before code starts requiring the new field.
2. Back up affected runtime files before writing.
3. Add missing CSV columns with blank/default values and preserve unknown columns when feasible.
4. Add missing settings fields with safe defaults.
5. Add or update tests for old local files, successful migration, and failure behavior.
6. Document user-visible changes in the README.

If migration fails, do not overwrite local data. Surface a clear error and tell the user to restore
from `data/backups/` or fix the broken local file.

## If Node Or npm Is Missing

Help the user install Node.js LTS, then retry the OS-specific launcher.

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

If macOS blocks `run-local.command`, have the user Control-click it, choose `Open`, and confirm. If
macOS says the file is not executable, run:

```bash
chmod +x run-local.command
./run-local.command
```

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
