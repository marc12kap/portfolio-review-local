# Portfolio Review Local

A local portfolio review app for tracking holdings, performance, cash, and exposure from editable
CSV and JSON files. It runs entirely on your computer with no database required.

Using Claude Code or another coding agent? See [AGENTS.md](AGENTS.md) for local setup instructions.

## Privacy Model

- Your working portfolio files live under `data/` on your computer and are ignored by Git.
- There is no account system, cloud database, or hosted backend.
- The local server may contact public market/logo endpoints to fetch live prices and company logos.
- Cached logos, backups, and edited CSV/JSON files remain local unless you deliberately share them.

## What It Does

- Reads positions from `data/positions.csv`.
- Reads centralized book settings from `data/settings.json`.
- Reads the performance path from `data/performance.csv`.
- Shows first-run setup choices when local data files do not exist yet.
- Fetches live prices from a local Node server when a row has share or contract quantity.
- Falls back to the CSV `marketValue` column when quantity is blank or prices are unavailable.
- Shows whether each displayed holding is using a live price, a CSV fallback, or missing price data.
- Fetches company logos through the local server and caches them in `data/logos`.
- Saves position edits back into `data/positions.csv` from the in-app editor.
- Nets option-like rows into the underlying ticker using `quantity * multiplier`, with short rows
  subtracting exposure.
- Consolidates multiple rows with the same `underlying` into one displayed holding and combined
  portfolio weight.
- Keeps private dollar amounts hidden by default behind the eye icon.

## Run Locally

From this folder:

```bash
npm run local
```

Then open:

```text
http://127.0.0.1:8787
```

This installs dependencies, builds the frontend, and starts the local server. If dependencies are
already installed and you only want to rebuild:

```bash
npm run build
npm start
```

On Windows, `run-local.ps1` runs the same one-command local startup.

## Validate Changes

Before opening a PR or sharing changes, run:

```bash
npm run check
```

This runs linting, TypeScript typechecking, the Node test suite, and the production build.

## Editing The Account

On a fresh clone, the app asks how to initialize local files:

- `Use Demo Data` copies the sample portfolio from `demo-data/sample`.
- `Start Blank` creates empty local CSV/JSON files.
- `Import CSV` creates local files from pasted `positions.csv` contents.

Use the `Edit Positions` button in the top right of the report. Saving writes directly to:

```text
data/positions.csv
data/settings.json
```

The repository ships example data in `demo-data/sample`. Your personal working files live in `data/`
and are ignored by Git, so local edits stay on your computer.

Before saving edits, the server writes timestamped backups to:

```text
data/backups/
```

The report intentionally shows percentages only. The editor includes account total value because the
app needs it to calculate position weights and leftover cash.

The eye icon reveals private dollar values:

- Starting book value comes from `baselineInvested` in `data/settings.json`.
- Current book value comes from `accountTotal` in `data/settings.json`.
- Current net invested is calculated from the actual position rows.
- Current cash is calculated as account total minus current net invested.
- Year-to-date return is calculated as `(current book value - starting book value) / starting book value`.

## Logos

The browser loads logos from local routes such as `/api/logo/SNDK`. On first request, the server
tries the `logoUrl` in `data/positions.csv`, then a favicon fallback from the same domain. Successful
images are saved into ignored local cache files under `data/logos`. The sample logos that ship with
the repo live in `demo-data/sample/logos`. If a logo cannot be found, the report shows ticker
initials instead of a broken image.

## Prices

The local server first tries live market prices from public quote endpoints and keeps successful
results in memory for about 10 minutes. Holdings with quantity use live prices when available and
show a `Live` badge in the report. If a live price is unavailable or a row has no quantity, the app
uses the row's `marketValue` fallback and shows `Fallback`. Rows without live prices or fallback
market values show `Missing`.

## CSV Columns

- `ticker`: the visible ticker in the report.
- `company`: company name used for logo alt text and fallback labeling.
- `underlying`: the stock ticker that option rows should net into.
- `assetType`: `stock`, `option`, or `spread`.
- `side`: `long` adds exposure; `short` subtracts exposure.
- `quantity`: shares for stock rows, contracts for option rows.
- `averageCost`: average cost per share or per contract.
- `multiplier`: leave blank for defaults (`1` for stock, `100` for options).
- `marketValue`: fallback value used when quantity is blank.
- `optionType`: `call` or `put` for option rows.
- `strikePrice`: option strike price.
- `expiryDate`: option expiration date.
- `premium`: option premium or cost basis per contract/share, depending on how you track it.
- `sector`: sector/theme bucket.
- `structure`: report wording, such as `Common shares` or `Shares with covered-call hedge`.
- `logoUrl`: company logo URL.

## Zip Handoff

When GitHub Releases are available, non-developers should download the release ZIP from the
repository's Releases page instead of cloning with Git. Release ZIPs include the source code,
sample data, setup docs, and package lockfile. They exclude `node_modules`, `dist`, and private
local working data from `data/`.

Maintainers can build the same source ZIP locally:

```bash
npm run release:zip
```

The generated ZIP is written to `release/`. It still expects the user to run `npm run local`, which
installs dependencies, builds `dist`, and starts the local server.

## License

MIT. See [LICENSE](LICENSE).
