# Portfolio Review Local

A local portfolio review app for tracking holdings, performance, cash, and exposure from editable
CSV and JSON files. It runs entirely on your computer with no database required.

Using Claude Code or another coding agent? See [AGENTS.md](AGENTS.md) for local setup instructions.

## What It Does

- Reads positions from `data/positions.csv`.
- Reads centralized book settings from `data/settings.json`.
- Reads the performance path from `data/performance.csv`.
- Fetches live prices from a local Node server when a row has share or contract quantity.
- Falls back to the CSV `marketValue` column when quantity is blank or prices are unavailable.
- Fetches company logos through the local server and caches them in `data/logos`.
- Saves position edits back into `data/positions.csv` from the in-app editor.
- Nets option-like rows into the underlying ticker using `quantity * multiplier`, with short rows
  subtracting exposure.
- Consolidates multiple rows with the same `underlying` into one displayed holding and combined
  portfolio weight.
- Keeps private dollar amounts hidden by default behind the eye icon.

## Run Locally

From this folder:

```powershell
node server.mjs
```

Then open:

```text
http://127.0.0.1:8787
```

If you edit the React source, rebuild it first:

```powershell
npm install
npm run local
```

On Windows, `run-local.ps1` runs the same install, build, and start steps.

## Editing The Account

Use the `Edit Positions` button in the top right of the report. Saving writes directly to:

```text
data/positions.csv
data/settings.json
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
images are saved into `data/logos`, so a zipped copy can include the cached logo files.

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

Zip the folder with `dist`, `data`, `src`, `public`, `server.mjs`, and the package files. You can
omit `node_modules`; the built app can run from `dist` with `node server.mjs`.
