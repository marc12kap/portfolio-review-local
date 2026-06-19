# Portfolio Review Local

A local-first investment portfolio review dashboard powered by editable CSV and JSON files.

It helps you review public-market holdings, cash, sector/theme allocation, concentration risk,
options exposure, live/fallback price status, and performance without a database, account system, or
hosted backend.

![Seeded example portfolio dashboard](docs/dashboard.png)

## Why Use This

- Runs on your computer.
- Stores your working portfolio files in ignored local `data/` files.
- Starts from fictional demo data, a blank book, or a pasted positions CSV.
- Keeps private dollar values hidden by default behind the eye icon.
- Uses editable files instead of a brokerage login or cloud database.
- Works with common stock rows, option rows, spreads, cash, fallback market values, and optional
  benchmark performance data.

Using an AI coding agent? See [AGENTS.md](AGENTS.md) for agent-oriented setup and local run
instructions. To seed your portfolio from pasted holdings, exports, screenshots, or rough notes, use
[AI_AGENT_IMPORT.md](AI_AGENT_IMPORT.md).

## Quick Start

### Windows

Double-click:

```text
run-local.bat
```

If Windows asks whether to allow the script, choose the option to run it anyway. The script opens a
terminal, installs dependencies, builds the app, and starts the local server.

### macOS

Double-click:

```text
run-local.command
```

If macOS blocks the file, Control-click `run-local.command`, choose `Open`, then confirm. If macOS
says the file is not executable, open Terminal in the project folder and run:

```bash
chmod +x run-local.command
./run-local.command
```

### Terminal Fallback

From the project folder, you can always run:

```bash
npm run local
```

Then open:

```text
http://127.0.0.1:8787
```

`npm run local` installs dependencies, builds the frontend, and starts the local Node server.

If Node.js is missing, install the LTS version from:

```text
https://nodejs.org/
```

Then close and reopen your terminal, Claude Code, or script window before trying again.

If port `8787` is already in use, close the old app window or run on another port:

Windows PowerShell:

```powershell
$env:PORT=8788
.\run-local.ps1
```

macOS Terminal:

```bash
PORT=8788 ./run-local.command
```

On first run, choose one of:

- `Use Demo Data`: copy the fictional sample investment portfolio from `demo-data/sample`.
- `Start Blank`: create empty local CSV/JSON files.
- `Import CSV`: initialize from pasted `positions.csv` contents.

Recommended first-time flow:

1. Start with `Use Demo Data` to tour the dashboard and see how holdings, cash, options, sectors,
   price badges, and backups behave.
2. When you are ready to use your real portfolio, click `Edit Positions`.
3. In the editor, use `Start Blank` under `Reset local files` to remove the seeded demo rows. The
   app creates backups before replacing anything.
4. Add your own holdings manually in the editor, or ask an AI agent to follow
   [AI_AGENT_IMPORT.md](AI_AGENT_IMPORT.md) and convert an existing holdings export, statement,
   spreadsheet, screenshot transcription, or notes into the local file format.
5. Put each holding into a useful `sector` or theme bucket, such as `Mega-Cap Technology`, `Broad
   Market ETFs`, `Energy`, `Cash & Equivalents`, or your own custom labels.
6. Confirm available cash, beginning book value, optional performance CSV history, and price badges
   before relying on the report.

While demo data is active, the dashboard keeps a sample-data notice visible so you do not mistake
the seeded portfolio for your own book. Starting blank, importing CSV data, or saving your own edits
marks the local data as user-owned.

After setup, use `Edit Positions` and the `Reset local files` actions to back up your current files
and either start blank or reload the demo portfolio. Reset actions require typed confirmation before
anything is replaced.

## What The Dashboard Shows

- Year-to-date portfolio return through today.
- Net invested and cash allocation.
- Sector/theme allocation.
- Top holding and top-five concentration.
- Options exposure by underlying.
- Holdings grouped by underlying ticker.
- Live, fallback, or missing price status.
- Optional benchmark line on the performance chart.

## Local Data Files

Your working files live in `data/` and are ignored by Git:

```text
data/positions.csv
data/settings.json
data/performance.csv
data/source.json
data/schema.json
data/logos/
data/backups/
```

The repo ships demo data in `demo-data/sample`. Your personal edits stay in `data/` unless you
deliberately share them.

When you save from the in-app editor, the server writes timestamped backups to `data/backups/`.
Resetting to blank or demo data also creates backups before replacing local files. Use `Edit
Positions`, then `Backups` to inspect local backup files and restore one file at a time with typed
confirmation. A restore creates a fresh backup of the current matching file before replacing it.

## Local Data Migrations

The app tracks the local file schema in ignored `data/schema.json`. When newer source code expects
additional CSV columns or settings fields, the server runs safe migrations before reading or saving
portfolio data.

Migrations are designed to:

- Create timestamped backups in `data/backups/` before changing affected files.
- Add missing `positions.csv` and `performance.csv` columns with blank/default values.
- Add missing `settings.json` fields with safe defaults.
- Preserve extra CSV columns during the migration rewrite.
- Stop with a clear error if a file cannot be migrated safely, such as invalid JSON.

To recover from a bad local edit, open `Edit Positions`, then `Backups`, choose the newest relevant
backup, and type `RESTORE` when prompted. You can also manually copy a backup from `data/backups/`
back to `data/` if the app cannot start.

## Local Health Check

Open the app health panel from the top-right controls, or call the local endpoint directly:

```text
http://127.0.0.1:8787/api/health
```

The health check reports server, data-file, schema, backup, source, and price-cache status using
counts and file presence only. It does not return holdings, tickers, cash values, or position rows.

## Year-Start Review

If the saved reporting period starts in a prior calendar year, the dashboard shows a compact
year-start review notice. The app does not change local files automatically. Review holdings, cash,
and current book value first, then use the notice's reset action only when the current book is ready
to become the new YTD baseline.

The reset action creates backups of `data/settings.json` and `data/performance.csv`, sets the
period start to January 1 of the current year, sets beginning book value to the current calculated
book value, and writes a fresh two-row performance baseline. You can dismiss the notice for the
current year without changing files.

## Privacy Model

- There is no account system, hosted backend, or cloud database.
- The local server may contact public market/logo endpoints for live prices and company logos.
- Cached logos, backups, and edited CSV/JSON files remain local.
- Private dollar amounts are hidden in the report until you click the eye icon.

## Editing Positions

Use `Edit Positions` in the top-right controls. Saving writes to:

```text
data/positions.csv
data/settings.json
```

The report intentionally emphasizes percentages. The editor asks for available cash; the app
calculates current book value from live/fallback holdings value plus that cash balance.

For faster setup, ask an AI agent to follow [AI_AGENT_IMPORT.md](AI_AGENT_IMPORT.md). The agent
should draft and preview normalized local files first, then write them only after you confirm.

Agents and future UI flows can preview proposed imports without writing local files:

```text
POST /api/import/preview
```

The JSON body accepts `positionsCsv` plus optional `settings`, `settingsJson`, and `performanceCsv`.
The response includes validation errors, asset-type counts, missing sectors/values, option-detail
gaps, price-review rows, assumptions, and benchmark/date/cash settings.

`data/settings.json` includes `cashBalance` for available cash. Older local files that only include
`accountTotal` still work; the app derives cash from legacy book value minus invested value until the
settings are saved again.

`data/settings.json` also includes `benchmarkName` and `benchmarkTicker`, which label the dashed
benchmark line when `data/performance.csv` includes benchmark returns. If no ticker is set, the app
falls back to `SPY` for an S&P 500 benchmark label.

## CSV Shape

`data/positions.csv` supports these columns:

| Column | Meaning |
| --- | --- |
| `ticker` | Visible ticker in the report. |
| `company` | Company name for labels and logo alt text. |
| `underlying` | Stock ticker that option rows net into. |
| `assetType` | `stock`, `option`, or `spread`. |
| `side` | `long` adds exposure; `short` subtracts exposure. |
| `quantity` | Shares for stock rows, contracts for option rows. |
| `averageCost` | Average cost per share or contract. |
| `multiplier` | Leave blank for defaults: `1` for stock, `100` for options. |
| `marketValue` | Fallback value used when quantity is blank or live prices are unavailable. |
| `optionType` | `call` or `put` for option rows. |
| `strikePrice` | Option strike price. |
| `expiryDate` | Option expiration date. |
| `premium` | Option premium or cost basis, depending on how you track it. |
| `sector` | Sector or theme bucket. |
| `structure` | Report wording, such as `Common shares` or `Shares with covered-call hedge`. |
| `logoUrl` | Company logo URL. |

The editor accepts formatted money values such as `$12,500.50`, but saved CSV values are normalized
to plain numbers such as `12500.5`. Quantity fields are for shares or contracts, not dollar values.

## Performance And Benchmarks

The dashboard values current holdings as of today in Eastern Time. It does not reconstruct past
holdings from a transaction ledger. Year-to-date return is calculated from today's current book value
versus the beginning book value you provide.

`data/performance.csv` supports:

| Column | Meaning |
| --- | --- |
| `date` | Chart point date in `YYYY-MM-DD` format. |
| `returnPct` | Portfolio cumulative return percentage for that date. |
| `benchmarkReturnPct` | Optional benchmark cumulative return percentage for that date. |

Historical chart points are optional and user-maintained. If `benchmarkReturnPct` is present for
more than one row, the performance chart displays a dashed benchmark line labeled by
`benchmarkName` and `benchmarkTicker` from `data/settings.json`. If benchmark returns are missing or
blank, the chart shows only the portfolio line. `benchmarkTicker` defaults to `SPY` when omitted.

## Prices And Logos

Prices:

- The server first tries public quote endpoints.
- Successful prices are cached in memory for about 10 minutes and persisted locally in
  `data/price-cache.json` as last-known prices.
- Holdings with quantity use fresh live prices when available.
- If a fresh price is unavailable, holdings use the last-known local price cache when available.
- Rows without usable live or cached prices fall back to manual `marketValue`.
- Rows with quantity but no live price, cached price, or `marketValue` appear in a review panel so
  you can fix the ticker, add a fallback value, or retry live prices later.

Logos:

- The browser loads logos from local routes such as `/api/logo/SNDK`.
- The server uses local cached logos first, then explicit `logoUrl` values from `positions.csv`.
- Explicit Clearbit URLs can fall back to the same-company favicon if Clearbit fails.
- Explicit Google favicon URLs are used as-is and are not converted into unrelated Google/Clearbit
  logo lookups.
- Set `logoUrl` to `initials`, `none`, or `no-logo` when a holding is private, ambiguous, or should
  not use automated public logo lookup.
- Successful images are cached under `data/logos`.
- If no logo is found, the report shows ticker initials instead of a broken image.

## Validate Changes

Before opening a PR or sharing changes:

```bash
npm run check
```

This runs linting, TypeScript typechecking, the Node test suite, and the production build.

## Release ZIPs

When GitHub Releases are available, non-developers should download the release ZIP from the
repository's Releases page. Release ZIPs include source code, sample data, setup docs, and the
package lockfile.

Release ZIPs exclude:

- `node_modules`
- `dist`
- private local working data from `data/`

Maintainers can build the same source ZIP locally:

```bash
npm run release:zip
```

The generated ZIP is written to `release/`.

## License

MIT. See [LICENSE](LICENSE).
