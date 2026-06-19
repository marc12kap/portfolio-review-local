# AI Agent Portfolio Import

Use this guide when an AI agent helps turn messy holdings data into local portfolio files for
Portfolio Review Local.

The workflow is local and review-first. Do not ask for brokerage passwords. Do not connect to a
brokerage account. Work only from files, exports, screenshots, pasted tables, or notes the user
chooses to provide.

## Recommended User Prompt

Paste this into an AI coding agent after opening this project folder:

```text
I want you to help seed my local Portfolio Review Local dashboard.

Use only the local files in this folder. Do not ask for brokerage login credentials. Do not send my
portfolio data anywhere except through the AI tool I am intentionally using in this chat.

First, inspect README.md, AGENTS.md, and AI_AGENT_IMPORT.md so you understand the required CSV and
settings formats.

Then ask me for my holdings data. I may paste a brokerage export, a table, rough notes, or a
screenshot transcription. Convert what I provide into:

1. data/positions.csv rows using the documented columns.
2. data/settings.json values for account name, available cash, beginning book value, benchmark, and
   reporting dates when I provide enough information.
3. data/performance.csv only if I provide performance history or benchmark return history.

Before writing anything:

1. Summarize the portfolio you inferred.
2. List assumptions and missing fields.
3. Show me the proposed positions table.
4. Ask me to confirm.

After I confirm:

1. Create backups of existing local data files if they exist.
2. Write the local files.
3. Run the app validation command.
4. Start the local app and give me the URL.
5. Tell me which tickers or rows need review because prices, sectors, option details, cash, or cost
   basis were missing.
```

## What The Agent Should Ask For

Ask for only the data needed to seed the dashboard:

- Ticker or symbol.
- Company or fund name.
- Shares for stock and ETF rows.
- Contracts for option rows.
- Long or short side.
- Average cost, if available.
- Current market value, if live prices may not be available.
- Sector or theme bucket.
- Option type, strike, expiration, premium, and multiplier for option rows.
- Available cash.
- Beginning book value for YTD return.
- Benchmark name and ticker, if different from S&P 500 / SPY.
- Performance history only if the user already has it.

Do not ask for:

- Brokerage passwords.
- Account login sessions.
- Full account numbers.
- Social Security numbers.
- API keys.
- Any data the user does not want stored in local files.

## Positions CSV Contract

Write `data/positions.csv` with these headers:

```csv
id,ticker,company,underlying,assetType,side,quantity,averageCost,multiplier,marketValue,optionType,strikePrice,expiryDate,premium,sector,structure,logoUrl
```

Rules:

- `id`: stable row number or short identifier.
- `ticker`: visible ticker or label.
- `company`: readable company, ETF, fund, or asset name.
- `underlying`: stock or ETF ticker that option rows net into.
- `assetType`: `stock`, `option`, `spread`, or `cash`.
- `side`: `long` or `short`.
- `quantity`: shares for stocks/ETFs, contracts for options.
- `averageCost`: optional cost basis per share or contract.
- `multiplier`: usually blank for stocks and `100` for options.
- `marketValue`: fallback dollar value when live prices may be missing or quantity is unknown.
- `optionType`: `call` or `put` for option rows.
- `strikePrice`: option strike.
- `expiryDate`: option expiration in `YYYY-MM-DD` format.
- `premium`: option premium or cost basis when known.
- `sector`: user-friendly sector or theme, such as `Mega-Cap Technology`, `Broad Market ETFs`,
  `Energy`, `Private Markets`, or `Cash & Equivalents`.
- `structure`: optional report wording, such as `Common shares`, `Broad market ETF`, or
  `Long call position`.
- `logoUrl`: optional trusted logo URL. Leave blank if unsure.

## Settings Contract

Write `data/settings.json` only after user confirmation.

Use this shape:

```json
{
  "accountName": "Personal Portfolio Book",
  "benchmarkName": "S&P 500",
  "benchmarkTicker": "SPY",
  "asOfDate": "2026-06-19",
  "periodStart": "2026-01-01",
  "periodEnd": "2026-06-19",
  "accountTotal": 0,
  "cashBalance": 0,
  "baselineInvested": 0
}
```

Rules:

- Set `cashBalance` from user-provided available cash.
- The app calculates current book value from holdings plus cash.
- Keep `benchmarkTicker` as `SPY` unless the user chooses another benchmark.
- Use current-year YTD dates unless the user explicitly provides another reporting period.
- Keep `accountTotal` for compatibility, but do not ask the user to manually calculate it.

## Performance CSV Contract

Only write `data/performance.csv` when the user provides performance history.

Use this shape:

```csv
date,returnPct,benchmarkReturnPct
2026-01-01,0,0
2026-06-19,4.2,3.1
```

If the user does not provide history, use the app's blank/default performance file and focus on
current holdings, cash, and beginning book value.

## Review Before Save

Before writing files, show:

- Total rows by asset type.
- Top holdings by market value or estimated value.
- Cash balance.
- Beginning book value.
- Benchmark.
- Rows missing quantity or market value.
- Rows missing sector/theme.
- Option rows missing type, strike, expiration, multiplier, or underlying.
- Tickers that may not price through public endpoints.

Ask for confirmation before writing local files.

## Validation After Save

After writing files:

```bash
npm run check
```

Then start the app:

Windows:

```powershell
.\run-local.ps1
```

macOS:

```bash
./run-local.command
```

Expected URL:

```text
http://127.0.0.1:8787/
```

Open the dashboard and review:

- Price status badges.
- Any invalid or unpriced ticker panel.
- Cash and current book value.
- Sector/theme allocation.
- Options exposure.
- Performance dates and benchmark label.
