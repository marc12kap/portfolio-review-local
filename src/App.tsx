import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  FileSearch,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

type Settings = {
  accountName: string
  benchmarkName: string
  benchmarkTicker: string
  asOfDate: string
  asOfLabel: string
  periodStart: string
  periodStartLabel: string
  periodEnd: string
  periodEndLabel: string
  accountTotal: number
  cashBalance: number
  baselineInvested: number
}

type Position = {
  id: string
  ticker: string
  company: string
  underlying: string
  assetType: string
  side: 'long' | 'short'
  quantity: string
  averageCost: string
  multiplier: string
  marketValue: string
  optionType: string
  strikePrice: string
  expiryDate: string
  premium: string
  sector: string
  structure: string
  logoUrl: string
}

type Holding = {
  ticker: string
  company: string
  sector: string
  structure: string
  logoUrl: string
  weight: number
  price: number | null
  priceSource: string
  priceFetchedAt: number | null
  priceStatus: 'live' | 'cached' | 'fallback' | 'missing'
}

type Sector = {
  name: string
  weight: number
}

type OptionExposure = {
  ticker: string
  value: number
  weight: number
  legCount: number
  callCount: number
  putCount: number
  spreadCount: number
  netContracts: number
  expirations: string[]
}

type PerformancePoint = {
  date: string
  returnPct: number
  benchmarkReturnPct: number | null
}

type PriceIssue = {
  rowNumber: number
  ticker: string
  underlying: string
  company: string
  quantity: number
  assetType: string
  message: string
}

type Portfolio = {
  setupRequired?: false
  settings: Settings
  source: {
    source: 'demo' | 'user'
    isDemo: boolean
  }
  positions: Position[]
  performance: PerformancePoint[]
  holdings: Holding[]
  priceIssues: PriceIssue[]
  optionExposures: OptionExposure[]
  sectors: Sector[]
  metrics: {
    accountTotal: number
    investedValue: number
    cashValue: number
    baselineInvested: number
    cashWeight: number
    netInvestedPercent: number
    diversificationSectors: number
    underlyingCount: number
    topFiveConcentration: number
    topHoldingWeight: number
    ytdReturnPercent: number
  }
  prices: Record<string, { price: number; source: string; fetchedAt: number }>
}

type SetupRequiredResponse = {
  setupRequired: true
}

type PortfolioResponse = Portfolio | SetupRequiredResponse

type ApiErrorPayload = {
  error?: string
  validationErrors?: string[]
}

type ResetMode = 'demo' | 'blank'
const gettingStartedDismissedKey = 'portfolio-review-demo-flow-modal-dismissed'

type ImportReviewRow = {
  rowNumber: number
  ticker: string
  underlying?: string
  company?: string
  message?: string
  missing?: string[]
}

type ImportPreview = {
  ok: boolean
  validationErrors: string[]
  positions: {
    rowCount: number
    assetTypeCounts: Record<string, number>
    missingSectorRows: ImportReviewRow[]
    missingValueRows: ImportReviewRow[]
    priceReviewRows: ImportReviewRow[]
    optionDetailGaps: ImportReviewRow[]
    tickerReviewRows: ImportReviewRow[]
  }
  settings: {
    accountName: string
    benchmarkName: string
    benchmarkTicker: string
    asOfDate: string
    periodStart: string
    periodEnd: string
    cashBalance: number
    baselineInvested: number
  }
  performance: {
    rowCount: number
    hasBenchmarkReturns: boolean
    startDate: string
    endDate: string
  }
  assumptions: string[]
}

type BackupMetadata = {
  fileName: string
  fileType: string
  targetFileName: string
  label: string
  createdAt: string
  sizeBytes: number
}

type BackupsResponse = {
  backups: BackupMetadata[]
}

type BackupRestoreResponse = {
  restore: {
    restored: BackupMetadata
    currentBackupFileName: string | null
  }
  portfolio: PortfolioResponse
}

type HealthFileStatus = {
  fileName: string
  exists: boolean
  sizeBytes: number
  updatedAt: string | null
}

type HealthCheck = {
  ok: boolean
  version: string
  checkedAt: string
  setupRequired: boolean
  checks: Record<string, { ok: boolean; message: string; missingRequired?: string[] }>
  files: HealthFileStatus[]
  schema: {
    exists: boolean
    ok: boolean
    version: number | null
    currentVersion: number
    migrationCount: number
    latestMigrationAt: string | null
    message: string
  }
  backups: {
    count: number
    newestCreatedAt: string | null
  }
  source: {
    source: string
    isDemo: boolean
    updatedAt: string | null
  }
  priceCache: {
    exists: boolean
    ok: boolean
    recordCount: number
    newestFetchedAt: string | null
    message: string
  }
  nextSteps: string[]
}

function readStoredFlag(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeStoredFlag(key: string, value: boolean) {
  try {
    globalThis.localStorage?.setItem(key, String(value))
  } catch {
    // Storage can be unavailable in some embedded browser contexts.
  }
}

function removeStoredFlag(key: string) {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Storage can be unavailable in some embedded browser contexts.
  }
}

async function fetchPortfolio() {
  const response = await fetch('/api/portfolio')
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'The local portfolio API is not running.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as PortfolioResponse
}

async function postSetup(mode: 'demo' | 'blank' | 'import', positionsCsv = '') {
  const response = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, positionsCsv }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'Unable to set up portfolio.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as PortfolioResponse
}

async function postImportPreview(payload: {
  positionsCsv: string
  settingsJson?: string
  performanceCsv?: string
}) {
  const response = await fetch('/api/import/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = errorPayload.validationErrors?.length ? errorPayload.validationErrors.join('\n') : ''
    throw new Error([errorPayload.error || 'Unable to preview import.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as ImportPreview
}

async function postImportCommit(payload: {
  positionsCsv: string
  settingsJson?: string
  performanceCsv?: string
}) {
  const response = await fetch('/api/import/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = errorPayload.validationErrors?.length ? errorPayload.validationErrors.join('\n') : ''
    throw new Error([errorPayload.error || 'Unable to import portfolio.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as PortfolioResponse
}

async function postReset(mode: ResetMode) {
  const response = await fetch('/api/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'Unable to reset portfolio.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as PortfolioResponse
}

async function fetchBackups() {
  const response = await fetch('/api/backups')
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'Unable to load backups.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as BackupsResponse
}

async function postBackupRestore(fileName: string) {
  const response = await fetch('/api/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'Unable to restore backup.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as BackupRestoreResponse
}

async function fetchHealthCheck() {
  const response = await fetch('/api/health')
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
    const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
    throw new Error([payload.error || 'Unable to load health check.', details].filter(Boolean).join('\n'))
  }
  return (await response.json()) as HealthCheck
}

function formatBackupDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatHealthDate(value: string | null) {
  return value ? formatBackupDate(value) : 'Not available'
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const emptyPosition = (): Position => ({
  id: crypto.randomUUID(),
  ticker: '',
  company: '',
  underlying: '',
  assetType: 'stock',
  side: 'long',
  quantity: '',
  averageCost: '',
  multiplier: '',
  marketValue: '',
  optionType: '',
  strikePrice: '',
  expiryDate: '',
  premium: '',
  sector: '',
  structure: '',
  logoUrl: '',
})

function formatPercent(value: number, digits = 1) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function formatWeight(value: number) {
  return `${value.toFixed(1)}%`
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)
}

function parseFormattedNumber(value: string) {
  const numeric = Number(value.replace(/[$,%\s,]/g, ''))
  return Number.isFinite(numeric) ? numeric : 0
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  helper,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  prefix?: string
  helper?: string
}) {
  return (
    <label>
      {label}
      <span className="input-shell">
        {prefix ? <span aria-hidden="true">{prefix}</span> : null}
        <input
          inputMode="decimal"
          value={value || ''}
          onChange={(event) => onChange(parseFormattedNumber(event.target.value))}
        />
      </span>
      {helper ? <small>{helper}</small> : null}
    </label>
  )
}

function classNameForReturn(value: number) {
  return value >= 0 ? 'positive' : 'negative'
}

function LogoImage({ holding }: { holding: Holding }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        className="logo-fallback"
        role="img"
        aria-label={`${holding.company} logo unavailable`}
        title="Logo unavailable; showing ticker initials"
      >
        {holding.ticker.slice(0, 2)}
      </span>
    )
  }

  return (
    <img
      src={`/api/logo/${encodeURIComponent(holding.ticker)}`}
      alt={`${holding.company} logo`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}

function formatPriceFetchedAt(value: number | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function priceStatusLabel(holding: Holding) {
  if (holding.priceStatus === 'live') return 'Live'
  if (holding.priceStatus === 'cached') return 'Cached'
  if (holding.priceStatus === 'fallback') return 'Fallback'
  return 'Missing'
}

function priceStatusTitle(holding: Holding) {
  if (holding.priceStatus === 'live') {
    return [
      `Live price from ${holding.priceSource || 'market data source'}.`,
      holding.priceFetchedAt ? `Fetched ${formatPriceFetchedAt(holding.priceFetchedAt)}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (holding.priceStatus === 'cached') {
    return [
      `Using the last known ${holding.priceSource || 'market data'} price because a fresh price was unavailable.`,
      holding.priceFetchedAt ? `Last fetched ${formatPriceFetchedAt(holding.priceFetchedAt)}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (holding.priceStatus === 'fallback') {
    return 'Using the CSV marketValue fallback because a live price was unavailable or quantity was blank.'
  }
  return 'No live price or fallback market value is available for this holding.'
}

function PerformanceChart({
  points,
  finalReturn,
  benchmarkName,
  benchmarkTicker,
}: {
  points: PerformancePoint[]
  finalReturn: number
  benchmarkName: string
  benchmarkTicker: string
}) {
  const width = 900
  const height = 178
  const paddingTop = 10
  const paddingBottom = 24
  const plotHeight = height - paddingTop - paddingBottom
  const chartPoints = points.length ? points : [{ date: '', returnPct: 0, benchmarkReturnPct: null }]
  const benchmarkPoints = chartPoints.filter((point) => point.benchmarkReturnPct !== null)
  const values = [
    ...chartPoints.map((point) => point.returnPct),
    ...benchmarkPoints.map((point) => point.benchmarkReturnPct ?? 0),
    finalReturn,
  ]
  const maxValue = Math.max(20, ...values) * 1.08
  const minValue = Math.min(0, ...values)
  const range = Math.max(1, maxValue - minValue)

  function coordinatesFor(valueForPoint: (point: PerformancePoint) => number) {
    return chartPoints.map((point, index) => {
      const x = chartPoints.length === 1 ? width : (index / (chartPoints.length - 1)) * width
      const y = paddingTop + ((maxValue - valueForPoint(point)) / range) * plotHeight
      return [x, y] as const
    })
  }

  const coordinates = coordinatesFor((point) => point.returnPct)
  const hasBenchmark = benchmarkPoints.length > 1

  function pathFor(pointsForPath: readonly (readonly [number, number])[]) {
    return pointsForPath
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ')
  }

  const linePath = pathFor(coordinates)
  const benchmarkLinePath = chartPoints
    .map((point, index) => {
      if (point.benchmarkReturnPct === null) return null
      const x = chartPoints.length === 1 ? width : (index / (chartPoints.length - 1)) * width
      const y = paddingTop + ((maxValue - point.benchmarkReturnPct) / range) * plotHeight
      return [x, y] as const
    })
    .filter((point): point is readonly [number, number] => Boolean(point))
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${width} ${height - paddingBottom} L 0 ${height - paddingBottom} Z`

  return (
    <div className="chart-panel" aria-label="Performance chart">
      {hasBenchmark ? (
        <div className="chart-legend" aria-label="Performance chart legend">
          <span><i className="portfolio-key" />Portfolio</span>
          <span>
            <i className="benchmark-key" />
            {benchmarkName || 'Benchmark'} ({benchmarkTicker || 'SPY'})
          </span>
        </div>
      ) : null}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Year-to-date return path">
        <defs>
          <linearGradient id="returnFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#87b9a5" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#87b9a5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="grid-line" x1="0" x2={width} y1="42" y2="42" />
        <line className="grid-line" x1="0" x2={width} y1="91" y2="91" />
        <line className="grid-line" x1="0" x2={width} y1="140" y2="140" />
        <path className="return-area" d={areaPath} />
        {hasBenchmark ? <path className="benchmark-line" d={benchmarkLinePath} /> : null}
        <path className="return-line" d={linePath} />
      </svg>
    </div>
  )
}

function SectorAllocation({ sectors }: { sectors: Sector[] }) {
  const rows = sectors.length ? sectors : [{ name: 'No holdings yet', weight: 0 }]

  return (
    <section className="report-section allocation-section">
      <div className="section-heading">
        <h2>Asset Allocation By Sector</h2>
        <span />
      </div>
      <p>
        Weights as a percentage of total market value (full bar = 100% of the account).
        Option positions are netted into their underlying.
      </p>
      <div className="sector-bars">
        {rows.map((sector) => (
          <div className="sector-row" key={sector.name}>
            <strong>{sector.name}</strong>
            <span className="bar-track">
              <span
                className={sector.name === 'Cash & Equivalents' ? 'bar-fill cash' : 'bar-fill'}
                style={{ width: `${Math.max(0.3, Math.min(100, sector.weight))}%` }}
              />
            </span>
            <b>{formatWeight(sector.weight)}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function concentrationMessage(topFiveConcentration: number, topHoldingWeight: number) {
  if (topHoldingWeight >= 35) {
    return 'Largest holding is doing most of the work. Review single-name exposure before adding more.'
  }
  if (topFiveConcentration >= 70) {
    return 'Top holdings drive most portfolio movement. Useful if intentional; worth monitoring closely.'
  }
  if (topFiveConcentration >= 50) {
    return 'Moderate concentration. The top holdings matter, but risk is not isolated to one line.'
  }
  return 'Broadly distributed across current holdings.'
}

function ConcentrationRisk({
  holdings,
  topFiveConcentration,
  topHoldingWeight,
}: {
  holdings: Holding[]
  topFiveConcentration: number
  topHoldingWeight: number
}) {
  const topHoldings = holdings.slice(0, 5)

  return (
    <section className="report-section concentration-section">
      <div className="section-heading">
        <h2>Concentration Check</h2>
        <span />
      </div>
      <div className="concentration-grid">
        <div className="concentration-summary">
          <span>Top 5 Weight</span>
          <strong>{formatWeight(topFiveConcentration)}</strong>
          <p>{concentrationMessage(topFiveConcentration, topHoldingWeight)}</p>
        </div>
        <div className="top-holdings-list" aria-label="Top five holdings by portfolio weight">
          {topHoldings.length ? (
            topHoldings.map((holding, index) => (
              <div className="top-holding-row" key={holding.ticker}>
                <span>{index + 1}</span>
                <b>{holding.ticker}</b>
                <div className="top-holding-bar">
                  <i style={{ width: `${Math.max(2, Math.min(100, holding.weight))}%` }} />
                </div>
                <strong>{formatWeight(holding.weight)}</strong>
              </div>
            ))
          ) : (
            <div className="empty-mini">Add positions to see concentration.</div>
          )}
        </div>
      </div>
    </section>
  )
}

function OptionsExposureSummary({ exposures }: { exposures: OptionExposure[] }) {
  return (
    <section className="report-section options-section">
      <div className="section-heading">
        <h2>Options Exposure</h2>
        <span />
      </div>
      {!exposures.length ? (
        <div className="empty-mini">No option or spread rows in the local positions file.</div>
      ) : (
        <div className="options-table" role="table" aria-label="Options exposure summary">
          <div className="options-head" role="row">
            <span>Underlying</span>
            <span>Legs</span>
            <span>Calls / Puts</span>
            <span>Expirations</span>
            <span>Net Contracts</span>
            <span>Exposure</span>
          </div>
          {exposures.map((exposure) => (
            <div className="options-row" role="row" key={exposure.ticker}>
              <b>{exposure.ticker}</b>
              <span title="Each option or spread row counted as one leg.">{exposure.legCount}</span>
              <span title="Short rows subtract from net exposure but still count as legs.">
                {exposure.callCount}C / {exposure.putCount}P
                {exposure.spreadCount ? ` / ${exposure.spreadCount} spread` : ''}
              </span>
              <span>{exposure.expirations.length ? exposure.expirations.join(', ') : '-'}</span>
              <span title="Signed contracts; short rows subtract.">
                {formatNumber(exposure.netContracts)}
              </span>
              <strong title="Exposure uses the same live-price or fallback-value math as holdings.">
                {formatWeight(exposure.weight)}
              </strong>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AllocationSnapshot({
  holdings,
  sectors,
  cashWeight,
  topFiveConcentration,
}: {
  holdings: Holding[]
  sectors: Sector[]
  cashWeight: number
  topFiveConcentration: number
}) {
  const topHolding = holdings[0]
  const topSector = sectors.find((sector) => sector.name !== 'Cash & Equivalents')

  return (
    <section className="allocation-snapshot" aria-label="Allocation snapshot">
      <div>
        <span>Top Theme</span>
        <strong>{topSector ? topSector.name : 'No holdings'}</strong>
        <small>{topSector ? formatWeight(topSector.weight) : '0.0%'}</small>
      </div>
      <div>
        <span>Top Holding</span>
        <strong>{topHolding ? topHolding.ticker : '-'}</strong>
        <small>{topHolding ? formatWeight(topHolding.weight) : '0.0%'}</small>
      </div>
      <div>
        <span>Top 5 Holdings</span>
        <strong>{formatWeight(topFiveConcentration)}</strong>
        <small>Combined weight</small>
      </div>
      <div>
        <span>Cash Bucket</span>
        <strong>{formatWeight(cashWeight)}</strong>
        <small>Uninvested allocation</small>
      </div>
    </section>
  )
}

function HoldingsDetail({
  sectors,
  holdings,
  cashWeight,
  netInvestedPercent,
}: {
  sectors: Sector[]
  holdings: Holding[]
  cashWeight: number
  netInvestedPercent: number
}) {
  const holdingsBySector = useMemo(() => {
    const map = new Map<string, Holding[]>()
    for (const holding of holdings) {
      const group = map.get(holding.sector) ?? []
      group.push(holding)
      map.set(holding.sector, group)
    }
    return map
  }, [holdings])

  return (
    <section className="report-section holdings-section">
      <div className="section-heading">
        <h2>Holdings Detail</h2>
        <span />
      </div>
      <p>
        Each line consolidates a single underlying; option overlays are netted into net exposure.
        Weights are a percentage of total market value.
      </p>
      {!holdings.length ? (
        <div className="empty-panel">
          <strong>No holdings yet</strong>
          <p>Use Edit Positions to add rows, or replace the local CSV at data/positions.csv.</p>
        </div>
      ) : null}
      <div className="holdings-table" role="table" aria-label="Holdings detail">
        <div className="table-header" role="row">
          <span>Position</span>
          <span>Structure</span>
          <span>Weight</span>
        </div>
        {sectors
          .filter((sector) => sector.name !== 'Cash & Equivalents')
          .map((sector) => {
            const rows = holdingsBySector.get(sector.name) ?? []
            return (
              <div className="sector-group" key={sector.name}>
                <div className="sector-title">{sector.name} - {formatWeight(sector.weight)}</div>
                {rows.map((holding) => (
                  <div className="holding-row" role="row" key={holding.ticker}>
                    <span className="position-cell">
                      <span className="logo-box">
                        <LogoImage holding={holding} />
                      </span>
                      <b>{holding.ticker}</b>
                    </span>
                    <span className="structure-cell">{holding.structure}</span>
                    <strong className="weight-cell">
                      {formatWeight(holding.weight)}
                      <span
                        className={`price-status ${holding.priceStatus}`}
                        title={priceStatusTitle(holding)}
                      >
                        {priceStatusLabel(holding)}
                      </span>
                    </strong>
                  </div>
                ))}
              </div>
            )
          })}
        <div className="summary-row">
          <span>Net Invested</span>
          <strong>{formatWeight(netInvestedPercent)}</strong>
        </div>
        <div className="summary-row">
          <span>Cash & Equivalents</span>
          <strong>{formatWeight(cashWeight)}</strong>
        </div>
        <div className="summary-row total">
          <span>Total</span>
          <strong>100.0%</strong>
        </div>
      </div>
    </section>
  )
}

function PriceIssuePanel({
  issues,
  onEdit,
}: {
  issues: PriceIssue[]
  onEdit: () => void
}) {
  if (!issues.length) return null

  return (
    <section className="report-section price-issue-section">
      <div className="section-heading">
        <h2>Price Inputs Need Review</h2>
        <span />
      </div>
      <p>
        These rows have quantity but no live price or fallback market value. Fix the ticker, add a
        fallback market value, or refresh prices later.
      </p>
      <div className="price-issue-list" aria-label="Rows with missing price inputs">
        {issues.map((issue) => (
          <div className="price-issue-row" key={`${issue.rowNumber}-${issue.ticker}`}>
            <b>{issue.ticker}</b>
            <span>Row {issue.rowNumber}</span>
            <span>{issue.company}</span>
            <strong>{issue.quantity} {issue.assetType === 'stock' ? 'shares' : 'contracts'}</strong>
          </div>
        ))}
      </div>
      <button type="button" onClick={onEdit}>
        Edit Rows
      </button>
    </section>
  )
}

function WelcomeGettingStartedModal({
  portfolio,
  showPrivate,
  onEdit,
  onShowPrivate,
  onDismiss,
}: {
  portfolio: Portfolio
  showPrivate: boolean
  onEdit: () => void
  onShowPrivate: () => void
  onDismiss: () => void
}) {
  const hasHoldings = portfolio.holdings.length > 0
  const hasPerformance = portfolio.performance.length > 1
  const hasPriceIssues = portfolio.priceIssues.length > 0
  const hasFallbackOrCachedPrices = portfolio.holdings.some((holding) =>
    ['cached', 'fallback', 'missing'].includes(holding.priceStatus),
  )

  return (
    <div className="welcome-backdrop" role="presentation">
      <div className="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="welcome-heading">
          <span>Welcome</span>
          <h2 id="welcome-title">Get Your Portfolio Ready</h2>
          <p>
            Use the demo as a quick tour. When you are ready to build your own portfolio, open
            Edit Positions, choose Start Blank, then add or import your real holdings.
          </p>
        </div>
        <ol className="welcome-list">
          <li>
            <button type="button" className={hasHoldings ? 'done' : ''} onClick={onEdit}>
              <b>1</b>
              <span>Tour the demo data</span>
              <small>Use the seeded portfolio to see allocations, sectors, prices, options, and backups.</small>
            </button>
          </li>
          <li>
            <button type="button" className={hasHoldings ? 'done' : ''} onClick={onEdit}>
              <b>2</b>
              <span>Start your own book</span>
              <small>Click Edit Positions, then Start Blank to remove demo rows after backups are created.</small>
            </button>
          </li>
          <li>
            <button type="button" className={hasHoldings ? 'done' : ''} onClick={onEdit}>
              <b>3</b>
              <span>Add holdings and sectors</span>
              <small>Enter tickers, shares or contracts, cash, and a sector/theme bucket for each row.</small>
            </button>
          </li>
          <li>
            <a href="/api/positions.csv" target="_blank" rel="noreferrer">
              <b>4</b>
              <span>Use an AI agent for import</span>
              <small>Ask an AI agent to preview your holdings as local CSV rows before anything is saved.</small>
            </a>
          </li>
          <li>
            <button
              type="button"
              className={showPrivate && hasPerformance && !hasPriceIssues ? 'done' : ''}
              onClick={onShowPrivate}
            >
              <b>5</b>
              <span>Review values and prices</span>
              <small>Confirm cash, beginning book value, performance history, and price badges before relying on the report.</small>
            </button>
          </li>
          <li>
            <button type="button" className={!hasPriceIssues ? 'done' : ''} onClick={onEdit}>
              <b>6</b>
              <span>Check price status</span>
              <small>
                {hasFallbackOrCachedPrices
                  ? 'Look for Live, Cached, Fallback, or Missing badges and fix rows that need attention.'
                  : 'Live prices are flowing; still scan the badges before relying on the report.'}
              </small>
            </button>
          </li>
          <li>
            <a href="/api/positions.csv" target="_blank" rel="noreferrer" className="done">
              <b>7</b>
              <span>Know where backups live</span>
              <small>Editor saves and reset actions create timestamped backups in the local data folder.</small>
            </a>
          </li>
        </ol>
        <div className="welcome-actions">
          <button type="button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

function SampleDataNotice({ onEdit }: { onEdit: () => void }) {
  return (
    <section className="sample-data-notice" aria-label="Sample data notice">
      <div>
        <strong>Sample data is active</strong>
        <span>Tour the dashboard, then use Edit Positions to start blank before adding your own holdings.</span>
      </div>
      <button type="button" onClick={onEdit}>
        Start From Your Data
      </button>
    </section>
  )
}

function assetTypeSummary(counts: Record<string, number>) {
  const entries = Object.entries(counts)
  if (!entries.length) return 'No rows found'
  return entries.map(([type, count]) => `${count} ${type}`).join(' · ')
}

function ImportIssueList({ title, rows }: { title: string; rows: ImportReviewRow[] }) {
  if (!rows.length) return null

  return (
    <div className="import-issue-list">
      <strong>{title}</strong>
      <ul>
        {rows.slice(0, 5).map((row) => (
          <li key={`${title}-${row.rowNumber}-${row.ticker || row.underlying}`}>
            Row {row.rowNumber}: {row.ticker || row.underlying || row.company || 'missing ticker'}
            {row.missing?.length ? ` needs ${row.missing.join(', ')}` : ''}
            {row.message ? ` - ${row.message}` : ''}
          </li>
        ))}
      </ul>
      {rows.length > 5 ? <small>{rows.length - 5} more rows need review.</small> : null}
    </div>
  )
}

function ImportPreviewSummary({ preview }: { preview: ImportPreview }) {
  return (
    <section className={`import-preview ${preview.ok ? 'is-ready' : 'needs-review'}`} aria-live="polite">
      <div className="import-preview-heading">
        <span>{preview.ok ? 'Ready To Import' : 'Needs Review'}</span>
        <strong>{preview.positions.rowCount} position rows</strong>
        <p>{assetTypeSummary(preview.positions.assetTypeCounts)}</p>
      </div>

      <div className="import-preview-grid">
        <div>
          <span>Benchmark</span>
          <strong>{preview.settings.benchmarkTicker || 'SPY'}</strong>
          <small>{preview.settings.benchmarkName}</small>
        </div>
        <div>
          <span>Cash</span>
          <strong>{formatCurrency(preview.settings.cashBalance)}</strong>
          <small>Available cash</small>
        </div>
        <div>
          <span>Beginning Value</span>
          <strong>{formatCurrency(preview.settings.baselineInvested)}</strong>
          <small>YTD return base</small>
        </div>
        <div>
          <span>Performance</span>
          <strong>{preview.performance.rowCount}</strong>
          <small>{preview.performance.hasBenchmarkReturns ? 'Includes benchmark' : 'Portfolio only'}</small>
        </div>
      </div>

      {preview.validationErrors.length ? (
        <div className="import-errors" role="alert">
          {preview.validationErrors.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      <ImportIssueList title="Missing sectors" rows={preview.positions.missingSectorRows} />
      <ImportIssueList title="Missing quantity or fallback value" rows={preview.positions.missingValueRows} />
      <ImportIssueList title="Live price review" rows={preview.positions.priceReviewRows} />
      <ImportIssueList title="Option details" rows={preview.positions.optionDetailGaps} />
      <ImportIssueList title="Ticker and logo review" rows={preview.positions.tickerReviewRows} />

      {preview.assumptions.length ? (
        <div className="import-assumptions">
          <strong>Assumptions</strong>
          {preview.assumptions.map((assumption) => (
            <p key={assumption}>{assumption}</p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AiImportWorkflow({
  onImported,
  onCancel,
  compact = false,
}: {
  onImported: (portfolio: Portfolio) => void
  onCancel?: () => void
  compact?: boolean
}) {
  const [positionsCsv, setPositionsCsv] = useState('')
  const [settingsJson, setSettingsJson] = useState('')
  const [performanceCsv, setPerformanceCsv] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const payload = { positionsCsv, settingsJson, performanceCsv }

  async function previewImport() {
    setWorking(true)
    setError('')
    setConfirmed(false)
    try {
      setPreview(await postImportPreview(payload))
    } catch (previewError) {
      setPreview(null)
      setError(previewError instanceof Error ? previewError.message : 'Preview failed.')
    } finally {
      setWorking(false)
    }
  }

  async function commitImport() {
    if (!preview?.ok || !confirmed) return
    setWorking(true)
    setError('')
    try {
      const response = await postImportCommit(payload)
      if ('setupRequired' in response && response.setupRequired) {
        throw new Error('Import did not finish. Try again or check local file permissions.')
      }
      onImported(response)
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'Import failed.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={`ai-import-workflow ${compact ? 'is-compact' : ''}`} aria-label="AI import preview">
      <div className="ai-import-heading">
        <div>
          <span>AI Agent Import</span>
          <strong>Preview before anything is saved</strong>
          <p>
            Paste AI-drafted local files, review the warnings, then explicitly confirm the import.
          </p>
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={working} aria-label="Close import workflow">
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <label>
        Positions CSV
        <textarea
          value={positionsCsv}
          onChange={(event) => {
            setPositionsCsv(event.target.value)
            setPreview(null)
            setConfirmed(false)
          }}
          placeholder={`ticker,company,underlying,assetType,side,quantity,averageCost,marketValue,sector
AAPL,Apple Inc.,AAPL,stock,long,25,180,,Mega-Cap Technology`}
        />
      </label>

      <div className="ai-import-optional-grid">
        <label>
          Settings JSON
          <textarea
            value={settingsJson}
            onChange={(event) => {
              setSettingsJson(event.target.value)
              setPreview(null)
              setConfirmed(false)
            }}
            placeholder={`{
  "accountName": "My Portfolio",
  "benchmarkTicker": "SPY",
  "cashBalance": 25000,
  "baselineInvested": 500000
}`}
          />
        </label>
        <label>
          Performance CSV
          <textarea
            value={performanceCsv}
            onChange={(event) => {
              setPerformanceCsv(event.target.value)
              setPreview(null)
              setConfirmed(false)
            }}
            placeholder={`date,returnPct,benchmarkReturnPct
2026-01-01,0,0
2026-03-31,4.2,3.8`}
          />
        </label>
      </div>

      <div className="ai-import-actions">
        <button type="button" onClick={() => void previewImport()} disabled={working || !positionsCsv.trim()}>
          <FileSearch size={15} aria-hidden="true" />
          {working && !preview ? 'Previewing...' : 'Preview Import'}
        </button>
      </div>

      {preview ? <ImportPreviewSummary preview={preview} /> : null}

      {preview?.ok ? (
        <div className="import-confirmation">
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Replace the current local files with this import after backups are created.
          </label>
          <button type="button" onClick={() => void commitImport()} disabled={!confirmed || working}>
            <Upload size={15} aria-hidden="true" />
            {working ? 'Importing...' : 'Confirm Import'}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="editor-error import-workflow-error" role="alert">
          {error.split('\n').map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Editor({
  portfolio,
  onClose,
  onSaved,
}: {
  portfolio: Portfolio
  onClose: () => void
  onSaved: (portfolio: Portfolio) => void
}) {
  const [settings, setSettings] = useState(portfolio.settings)
  const [positions, setPositions] = useState(portfolio.positions)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetMode, setResetMode] = useState<ResetMode | null>(null)
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [backupsOpen, setBackupsOpen] = useState(false)
  const [backups, setBackups] = useState<BackupMetadata[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [restoreBackup, setRestoreBackup] = useState<BackupMetadata | null>(null)
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')

  function updatePosition(id: string, key: keyof Position, value: string) {
    setPositions((current) =>
      current.map((position) => (position.id === id ? { ...position, [key]: value } : position)),
    )
  }

  async function saveChanges() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings, positions }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload
        const details = payload.validationErrors?.length ? payload.validationErrors.join('\n') : ''
        throw new Error([payload.error || 'Unable to save portfolio.', details].filter(Boolean).join('\n'))
      }
      onSaved(await response.json())
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  function openResetConfirmation(mode: ResetMode) {
    setResetMode(mode)
    setResetConfirmation('')
    setBackupsOpen(false)
    setRestoreBackup(null)
    setRestoreConfirmation('')
    setBackupMessage('')
    setError('')
  }

  async function loadBackups() {
    setBackupsLoading(true)
    setError('')
    try {
      const response = await fetchBackups()
      setBackups(response.backups)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'Unable to load backups.')
    } finally {
      setBackupsLoading(false)
    }
  }

  function toggleBackupsPanel() {
    setResetMode(null)
    setResetConfirmation('')
    setImportOpen(false)
    setRestoreBackup(null)
    setRestoreConfirmation('')
    setBackupMessage('')
    setBackupsOpen((current) => {
      const next = !current
      if (next) void loadBackups()
      return next
    })
  }

  async function resetData(mode: ResetMode) {
    setResetting(true)
    setError('')
    try {
      const response = await postReset(mode)
      if ('setupRequired' in response && response.setupRequired) {
        throw new Error('Reset did not finish. Try again or check local file permissions.')
      }
      onSaved(response)
      onClose()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Reset failed.')
    } finally {
      setResetting(false)
    }
  }

  async function restoreSelectedBackup() {
    if (!restoreBackup) return
    setRestoring(true)
    setError('')
    setBackupMessage('')
    try {
      const response = await postBackupRestore(restoreBackup.fileName)
      if ('setupRequired' in response.portfolio && response.portfolio.setupRequired) {
        throw new Error('Restore finished, but local portfolio data is still incomplete.')
      }
      setSettings(response.portfolio.settings)
      setPositions(response.portfolio.positions)
      onSaved(response.portfolio)
      setBackupMessage(
        `${restoreBackup.label} restored. Current ${restoreBackup.targetFileName} was backed up first.`,
      )
      setRestoreBackup(null)
      setRestoreConfirmation('')
      await loadBackups()
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Restore failed.')
    } finally {
      setRestoring(false)
    }
  }

  const resetPhrase = resetMode === 'demo' ? 'RELOAD DEMO' : 'START BLANK'
  const resetTitle = resetMode === 'demo' ? 'Reload demo data' : 'Start with blank files'
  const resetDescription =
    resetMode === 'demo'
      ? 'This replaces your current local portfolio with the fictional demo portfolio.'
      : 'This replaces your current local portfolio with empty starter files.'
  const resetAllowed = resetConfirmation.trim() === resetPhrase
  const restoreAllowed = restoreConfirmation.trim() === 'RESTORE'

  return (
    <div className="editor-backdrop" role="presentation">
      <aside className="editor-panel" aria-label="Edit portfolio positions">
        <div className="editor-header">
          <div>
            <span>Local CSV Editor</span>
            <h2>Update Positions</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close editor">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-grid">
          <label>
            Account title
            <input
              value={settings.accountName}
              onChange={(event) => setSettings({ ...settings, accountName: event.target.value })}
            />
          </label>
          <label>
            Benchmark name
            <input
              value={settings.benchmarkName}
              onChange={(event) => setSettings({ ...settings, benchmarkName: event.target.value })}
            />
          </label>
          <label>
            Benchmark ticker
            <input
              value={settings.benchmarkTicker}
              onChange={(event) =>
                setSettings({ ...settings, benchmarkTicker: event.target.value.toUpperCase() })
              }
              placeholder="SPY"
            />
          </label>
          <label>
            Report date
            <input
              type="date"
              value={settings.asOfDate}
              readOnly
              disabled
            />
            <small>Uses today's Eastern Time date. Add performance CSV rows for history.</small>
          </label>
          <NumberField
            label="Available cash"
            value={settings.cashBalance}
            onChange={(cashBalance) => setSettings({ ...settings, cashBalance })}
            prefix="$"
            helper="Cash not invested in positions."
          />
          <NumberField
            label="Beginning book value"
            value={settings.baselineInvested}
            onChange={(baselineInvested) => setSettings({ ...settings, baselineInvested })}
            prefix="$"
            helper="Starting value for YTD return."
          />
        </div>

        <div className="reset-panel" aria-label="Reset local portfolio data">
          <div>
            <strong>Reset local files</strong>
            <p>
              Finished touring the demo? Back up the current files, then start blank for your own
              portfolio or reload the sample later.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => openResetConfirmation('blank')}
              disabled={resetting || saving || importOpen || backupsOpen || restoring}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Start Blank
            </button>
            <button
              type="button"
              onClick={() => openResetConfirmation('demo')}
              disabled={resetting || saving || importOpen || backupsOpen || restoring}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Reload Demo
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              disabled={resetting || saving || Boolean(resetMode) || backupsOpen}
            >
              <Upload size={15} aria-hidden="true" />
              Import
            </button>
            <button
              type="button"
              onClick={toggleBackupsPanel}
              disabled={resetting || saving || importOpen || Boolean(resetMode) || restoring}
            >
              <FileSearch size={15} aria-hidden="true" />
              Backups
            </button>
          </div>
        </div>

        {backupsOpen ? (
          <div className="backup-panel" aria-label="Local backups and restore">
            <div className="backup-panel-heading">
              <div>
                <strong>Local backups</strong>
                <p>
                  Backups live in data/backups. Restore one file at a time; the current matching file
                  is backed up before replacement.
                </p>
              </div>
              <button type="button" onClick={() => void loadBackups()} disabled={backupsLoading || restoring}>
                <RefreshCw size={15} aria-hidden="true" />
                {backupsLoading ? 'Checking...' : 'Refresh'}
              </button>
            </div>

            {backupMessage ? <div className="backup-success">{backupMessage}</div> : null}

            {backupsLoading ? <p className="backup-empty">Checking data/backups...</p> : null}

            {!backupsLoading && backups.length === 0 ? (
              <p className="backup-empty">No restorable backup files found yet.</p>
            ) : null}

            {!backupsLoading && backups.length > 0 ? (
              <div className="backup-list">
                {backups.map((backup) => (
                  <div className="backup-row" key={backup.fileName}>
                    <div>
                      <span>{backup.label}</span>
                      <strong>{formatBackupDate(backup.createdAt)}</strong>
                      <small>
                        {backup.fileName} - {formatFileSize(backup.sizeBytes)}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreBackup(backup)
                        setRestoreConfirmation('')
                        setBackupMessage('')
                        setError('')
                      }}
                      disabled={restoring}
                    >
                      <RotateCcw size={15} aria-hidden="true" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {restoreBackup ? (
          <div className="reset-confirmation backup-confirmation" role="alertdialog" aria-label="Restore backup">
            <div>
              <strong>Restore {restoreBackup.label.toLowerCase()}</strong>
              <p>
                This replaces {restoreBackup.targetFileName} with {restoreBackup.fileName}. The current
                file will be backed up first.
              </p>
              <label>
                Type <b>RESTORE</b> to continue
                <input
                  value={restoreConfirmation}
                  onChange={(event) => setRestoreConfirmation(event.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setRestoreBackup(null)
                  setRestoreConfirmation('')
                }}
                disabled={restoring}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void restoreSelectedBackup()}
                disabled={!restoreAllowed || restoring}
              >
                {restoring ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        ) : null}

        {importOpen ? (
          <div className="editor-import-panel">
            <AiImportWorkflow
              compact
              onCancel={() => setImportOpen(false)}
              onImported={(nextPortfolio) => {
                onSaved(nextPortfolio)
                onClose()
              }}
            />
          </div>
        ) : null}

        {resetMode ? (
          <div className="reset-confirmation" role="alertdialog" aria-label={resetTitle}>
            <div>
              <strong>{resetTitle}</strong>
              <p>
                {resetDescription} The app will create backups first, then replace settings,
                positions, performance, and cached logos.
              </p>
              <label>
                Type <b>{resetPhrase}</b> to continue
                <input
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  autoFocus
                />
              </label>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  setResetMode(null)
                  setResetConfirmation('')
                }}
                disabled={resetting}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void resetData(resetMode)}
                disabled={!resetAllowed || resetting}
              >
                {resetting ? 'Replacing...' : resetTitle}
              </button>
            </div>
          </div>
        ) : null}

        {!importOpen ? (
          <>
            <div className="positions-editor">
              <div className="editor-toolbar">
                <a href="/api/positions.csv" target="_blank" rel="noreferrer">
                  Open CSV
                </a>
                <button type="button" onClick={() => setPositions([...positions, emptyPosition()])}>
                  <Plus size={15} aria-hidden="true" />
                  Add Row
                </button>
              </div>
              <p className="editor-note">
                Enter shares for stock rows and contracts for option rows. Money fields accept commas
                and dollar signs; saved CSV values stay numeric.
              </p>
              <div className="editable-table">
                <div className="editable-row editable-head">
                  <span>Ticker</span>
                  <span>Shares / contracts</span>
                  <span>Avg cost</span>
                  <span>Fallback value</span>
                  <span>Type</span>
                  <span>Side</span>
                  <span>Opt</span>
                  <span>Strike</span>
                  <span>Multiplier</span>
                  <span>Expiry</span>
                  <span>Premium</span>
                  <span>Sector</span>
                  <span>Structure</span>
                  <span />
                </div>
                {positions.map((position) => (
                  <div className="editable-row" key={position.id}>
                    <input
                      value={position.ticker}
                      onChange={(event) => updatePosition(position.id, 'ticker', event.target.value)}
                      aria-label="Ticker"
                    />
                    <input
                      className="quantity-input"
                      value={position.quantity}
                      onChange={(event) => updatePosition(position.id, 'quantity', event.target.value)}
                      aria-label="Shares or contracts"
                      inputMode="decimal"
                      placeholder={position.assetType === 'stock' ? 'shares' : 'contracts'}
                    />
                    <input
                      className="money-input"
                      value={position.averageCost}
                      onChange={(event) => updatePosition(position.id, 'averageCost', event.target.value)}
                      aria-label="Average cost"
                      inputMode="decimal"
                      placeholder="$ / unit"
                    />
                    <input
                      className="money-input"
                      value={position.marketValue}
                      onChange={(event) => updatePosition(position.id, 'marketValue', event.target.value)}
                      aria-label="Fallback market value"
                      inputMode="decimal"
                      placeholder="$ total"
                    />
                    <select
                      value={position.assetType}
                      onChange={(event) => updatePosition(position.id, 'assetType', event.target.value)}
                      aria-label="Asset type"
                    >
                      <option value="stock">Stock</option>
                      <option value="option">Option</option>
                      <option value="spread">Spread</option>
                    </select>
                    <select
                      value={position.side}
                      onChange={(event) => updatePosition(position.id, 'side', event.target.value)}
                      aria-label="Side"
                    >
                      <option value="long">Long</option>
                      <option value="short">Short</option>
                    </select>
                    <select
                      value={position.optionType}
                      onChange={(event) => updatePosition(position.id, 'optionType', event.target.value)}
                      aria-label="Option type"
                    >
                      <option value="">-</option>
                      <option value="call">Call</option>
                      <option value="put">Put</option>
                    </select>
                    <input
                      className="money-input"
                      value={position.strikePrice}
                      onChange={(event) => updatePosition(position.id, 'strikePrice', event.target.value)}
                      aria-label="Strike price"
                      inputMode="decimal"
                      placeholder="$ strike"
                    />
                    <input
                      className="quantity-input"
                      value={position.multiplier}
                      onChange={(event) => updatePosition(position.id, 'multiplier', event.target.value)}
                      aria-label="Contract multiplier"
                      inputMode="decimal"
                      placeholder="100"
                    />
                    <input
                      type="date"
                      value={position.expiryDate}
                      onChange={(event) => updatePosition(position.id, 'expiryDate', event.target.value)}
                      aria-label="Expiry date"
                    />
                    <input
                      className="money-input"
                      value={position.premium}
                      onChange={(event) => updatePosition(position.id, 'premium', event.target.value)}
                      aria-label="Premium"
                      inputMode="decimal"
                      placeholder="$"
                    />
                    <input
                      value={position.sector}
                      onChange={(event) => updatePosition(position.id, 'sector', event.target.value)}
                      aria-label="Sector"
                    />
                    <input
                      value={position.structure}
                      onChange={(event) => updatePosition(position.id, 'structure', event.target.value)}
                      aria-label="Structure"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${position.ticker || 'row'}`}
                      onClick={() =>
                        setPositions((current) => current.filter((row) => row.id !== position.id))
                      }
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error ? (
              <div className="editor-error" role="alert">
                {error.split('\n').map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
            <div className="editor-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="save-button" type="button" onClick={saveChanges} disabled={saving}>
                <Save size={16} aria-hidden="true" />
                {saving ? 'Saving...' : 'Save CSV'}
              </button>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  )
}

function EmptyPortfolioState({ onEdit }: { onEdit: () => void }) {
  return (
    <section className="report-section empty-portfolio-section">
      <div className="empty-panel">
        <strong>No portfolio rows yet</strong>
        <p>
          Add holdings in the local editor or paste rows into data/positions.csv. The app will keep
          your working data local and create backups before saves.
        </p>
        <button type="button" onClick={onEdit}>
          <Plus size={15} aria-hidden="true" />
          Add Positions
        </button>
      </div>
    </section>
  )
}

function LoadErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const lines = (error || 'Unable to load portfolio.').split('\n').filter(Boolean)

  return (
    <main className="state-screen">
      <h1>Portfolio Review</h1>
      <div className="state-card" role="alert">
        <strong>Unable to load the local portfolio</strong>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>Check that the local server is running and that data files are readable.</p>
        <button type="button" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Retry
        </button>
      </div>
    </main>
  )
}

function HealthCheckPanel({
  health,
  loading,
  error,
  onRefresh,
  onClose,
}: {
  health: HealthCheck | null
  loading: boolean
  error: string
  onRefresh: () => void
  onClose: () => void
}) {
  const fileSummary = health?.files.map((file) => `${file.fileName}: ${file.exists ? 'Found' : 'Missing'}`) || []

  return (
    <div className="health-backdrop" role="presentation">
      <aside className="health-panel" aria-label="Local app health check">
        <div className="health-header">
          <div>
            <span>Local Checkup</span>
            <h2>App Health</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close health check">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className={`health-summary ${health?.ok ? 'is-ok' : 'needs-attention'}`}>
          {health?.ok ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
          <div>
            <strong>{loading ? 'Checking local app...' : health?.ok ? 'Local app looks healthy' : 'Needs attention'}</strong>
            <p>
              Version {health?.version || 'unknown'} - Checked {health ? formatHealthDate(health.checkedAt) : 'now'}
            </p>
          </div>
        </div>

        <button className="health-refresh" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" />
          {loading ? 'Checking...' : 'Run Check'}
        </button>

        {error ? (
          <div className="editor-error health-error" role="alert">
            {error.split('\n').map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}

        {health ? (
          <>
            <div className="health-grid">
              {Object.entries(health.checks).map(([key, check]) => (
                <div className={check.ok ? 'is-ok' : 'needs-attention'} key={key}>
                  <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                  <strong>{check.ok ? 'OK' : 'Review'}</strong>
                  <small>{check.message}</small>
                </div>
              ))}
            </div>

            <div className="health-detail-list">
              <div>
                <span>Data files</span>
                <p>{fileSummary.join(' | ')}</p>
              </div>
              <div>
                <span>Schema</span>
                <p>
                  Version {health.schema.version ?? 'missing'} of {health.schema.currentVersion};{' '}
                  {health.schema.migrationCount} migration record{health.schema.migrationCount === 1 ? '' : 's'}.
                </p>
              </div>
              <div>
                <span>Backups</span>
                <p>
                  {health.backups.count} file{health.backups.count === 1 ? '' : 's'}
                  {health.backups.newestCreatedAt ? `; newest ${formatHealthDate(health.backups.newestCreatedAt)}` : ''}.
                </p>
              </div>
              <div>
                <span>Price cache</span>
                <p>
                  {health.priceCache.recordCount} cached record{health.priceCache.recordCount === 1 ? '' : 's'}
                  {health.priceCache.newestFetchedAt
                    ? `; newest ${formatHealthDate(health.priceCache.newestFetchedAt)}`
                    : ''}.
                </p>
              </div>
              <div>
                <span>Source</span>
                <p>
                  {health.source.source === 'demo'
                    ? 'Demo data'
                    : health.source.source === 'user'
                      ? 'User data'
                      : 'Not set'}
                </p>
              </div>
            </div>

            <div className="health-next-steps">
              <strong>Next steps</strong>
              {health.nextSteps.map((step) => (
                <p key={step}>{step}</p>
              ))}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  )
}

function FirstRunSetup({
  onReady,
  onOpenHealth,
}: {
  onReady: (portfolio: Portfolio) => void
  onOpenHealth: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function setup(mode: 'demo' | 'blank') {
    setSaving(true)
    setError('')
    try {
      const response = await postSetup(mode)
      if ('setupRequired' in response && response.setupRequired) {
        throw new Error('Setup did not finish. Try again or check local file permissions.')
      }
      onReady(response)
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Setup failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="state-screen setup-screen">
      <h1>Portfolio Review</h1>
      <div className="setup-panel" aria-label="First-run setup">
        <div className="setup-heading">
          <span>Local Setup</span>
          <strong>Choose how to start</strong>
          <p>
            The app creates editable files on this computer. You can change or reset them later.
          </p>
          <button className="setup-health-button" type="button" onClick={onOpenHealth}>
            <Activity size={15} aria-hidden="true" />
            Health Check
          </button>
        </div>
        <div className="setup-actions">
          <button type="button" onClick={() => void setup('demo')} disabled={saving}>
            <b>Use Demo Data</b>
            <span>Load a fictional portfolio so you can explore the dashboard first.</span>
          </button>
          <button type="button" onClick={() => void setup('blank')} disabled={saving}>
            <b>Start Blank</b>
            <span>Create empty local files and add your own holdings from scratch.</span>
          </button>
        </div>
        <AiImportWorkflow onImported={onReady} />
        {error ? (
          <div className="editor-error setup-error" role="alert">
            {error.split('\n').map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  )
}

function App() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState('')
  const [showPrivate, setShowPrivate] = useState(false)
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(() =>
    readStoredFlag(gettingStartedDismissedKey),
  )

  function acceptPortfolio(nextPortfolio: Portfolio) {
    if (nextPortfolio.source?.isDemo) {
      setGettingStartedDismissed(false)
    }
    setPortfolio(nextPortfolio)
  }

  async function loadPortfolio() {
    setLoading(true)
    setError('')
    try {
      const nextPortfolio = await fetchPortfolio()
      if ('setupRequired' in nextPortfolio && nextPortfolio.setupRequired) {
        setSetupRequired(true)
        setPortfolio(null)
      } else {
        setSetupRequired(false)
        acceptPortfolio(nextPortfolio)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load portfolio.')
    } finally {
      setLoading(false)
    }
  }

  async function loadHealth() {
    setHealthLoading(true)
    setHealthError('')
    try {
      setHealth(await fetchHealthCheck())
    } catch (loadHealthError) {
      setHealthError(loadHealthError instanceof Error ? loadHealthError.message : 'Unable to load health check.')
    } finally {
      setHealthLoading(false)
    }
  }

  function openHealth() {
    setHealthOpen(true)
    void loadHealth()
  }

  useEffect(() => {
    let canceled = false

    async function loadInitialPortfolio() {
      try {
        const nextPortfolio = await fetchPortfolio()
        if (!canceled) {
          if ('setupRequired' in nextPortfolio && nextPortfolio.setupRequired) {
            setSetupRequired(true)
            setPortfolio(null)
          } else {
            setSetupRequired(false)
            acceptPortfolio(nextPortfolio)
          }
        }
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load portfolio.')
        }
      } finally {
        if (!canceled) setLoading(false)
      }
    }

    void loadInitialPortfolio()

    return () => {
      canceled = true
    }
  }, [])

  if (loading && !portfolio) {
    return <main className="state-screen">Loading portfolio review...</main>
  }

  if (setupRequired) {
    return (
      <>
        <FirstRunSetup
          onReady={(nextPortfolio) => {
            removeStoredFlag(gettingStartedDismissedKey)
            setGettingStartedDismissed(false)
            setSetupRequired(false)
            acceptPortfolio(nextPortfolio)
          }}
          onOpenHealth={openHealth}
        />
        {healthOpen ? (
          <HealthCheckPanel
            health={health}
            loading={healthLoading}
            error={healthError}
            onRefresh={() => void loadHealth()}
            onClose={() => setHealthOpen(false)}
          />
        ) : null}
      </>
    )
  }

  if (!portfolio) {
    return <LoadErrorState error={error} onRetry={() => void loadPortfolio()} />
  }

  const { settings, metrics } = portfolio
  const hasHoldings = portfolio.holdings.length > 0
  const showGettingStarted = !gettingStartedDismissed
  const sampleDataActive = portfolio.source?.isDemo

  return (
    <>
      <div className="app-controls" aria-label="Portfolio editor controls">
        <button
          type="button"
          onClick={() => setShowPrivate((current) => !current)}
          aria-label={showPrivate ? 'Hide private dollar amounts' : 'Show private dollar amounts'}
          title={showPrivate ? 'Hide dollar amounts' : 'Show dollar amounts'}
        >
          {showPrivate ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void loadPortfolio()} aria-label="Refresh live prices">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={openHealth} aria-label="Open app health check" title="App health">
          <Activity size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setEditorOpen(true)}>
          <Edit3 size={15} aria-hidden="true" />
          Edit Positions
        </button>
      </div>
      <main className="portfolio-page">
        <header className="report-header">
          <div>
            <h1>{settings.accountName}</h1>
            <h3>Centralized local portfolio book across custodians</h3>
          </div>
          <div className="header-actions">
            <span>As of {settings.asOfLabel}</span>
          </div>
        </header>

        {sampleDataActive ? <SampleDataNotice onEdit={() => setEditorOpen(true)} /> : null}

        <section className="metric-strip" aria-label="Portfolio metrics">
          <div>
            <span>Year-To-Date Return</span>
            <strong className={classNameForReturn(metrics.ytdReturnPercent)}>
              {formatPercent(metrics.ytdReturnPercent, 2)}
            </strong>
            <small>{settings.periodStartLabel} - today</small>
          </div>
          <div>
            <span>Net Invested</span>
            <strong>{formatWeight(metrics.netInvestedPercent)}</strong>
            <small>Long exposure</small>
          </div>
          <div>
            <span>Cash & Equivalents</span>
            <strong>{formatWeight(metrics.cashWeight)}</strong>
            <small>No margin drawn</small>
          </div>
          <div>
            <span>Diversification</span>
            <strong>{metrics.diversificationSectors} sectors</strong>
            <small>{metrics.underlyingCount} underlyings</small>
          </div>
        </section>

        {showPrivate ? (
          <section className="private-capital-strip" aria-label="Private invested capital">
            <div>
              <span>Beginning of Year Starting Book Value</span>
              <strong>{formatCurrency(metrics.baselineInvested)}</strong>
            </div>
            <div>
              <span>Current Book Value</span>
              <strong>{formatCurrency(metrics.accountTotal)}</strong>
            </div>
            <div>
              <span>Current Net Invested</span>
              <strong>{formatCurrency(metrics.investedValue)}</strong>
            </div>
            <div>
              <span>Current Cash</span>
              <strong>{formatCurrency(metrics.cashValue)}</strong>
            </div>
          </section>
        ) : null}

        <AllocationSnapshot
          holdings={portfolio.holdings}
          sectors={portfolio.sectors}
          cashWeight={metrics.cashWeight}
          topFiveConcentration={metrics.topFiveConcentration}
        />

        <section className="report-section performance-section">
          <div className="section-heading">
            <h2>Performance - Year To Date</h2>
            <span />
          </div>
          <p>
            Cumulative return through today. Return is based on current book value versus starting
            book value. Historical chart points require user-maintained performance CSV rows.
          </p>
          <PerformanceChart
            points={portfolio.performance}
            finalReturn={metrics.ytdReturnPercent}
            benchmarkName={settings.benchmarkName}
            benchmarkTicker={settings.benchmarkTicker}
          />
          <div className="chart-captions">
            <span>{settings.periodStartLabel} - baseline 0%</span>
            <strong>
              Today -{' '}
              <b className={classNameForReturn(metrics.ytdReturnPercent)}>
                {formatPercent(metrics.ytdReturnPercent, 2)}
              </b>
            </strong>
          </div>
        </section>

        <SectorAllocation sectors={portfolio.sectors} />
        <ConcentrationRisk
          holdings={portfolio.holdings}
          topFiveConcentration={metrics.topFiveConcentration}
          topHoldingWeight={metrics.topHoldingWeight}
        />
        <OptionsExposureSummary exposures={portfolio.optionExposures} />
        {!hasHoldings ? <EmptyPortfolioState onEdit={() => setEditorOpen(true)} /> : null}
        <PriceIssuePanel
          issues={portfolio.priceIssues}
          onEdit={() => setEditorOpen(true)}
        />
        <HoldingsDetail
          sectors={portfolio.sectors}
          holdings={portfolio.holdings}
          cashWeight={metrics.cashWeight}
          netInvestedPercent={metrics.netInvestedPercent}
        />

      </main>
      {editorOpen ? (
        <Editor
          portfolio={portfolio}
          onClose={() => setEditorOpen(false)}
          onSaved={(nextPortfolio) => acceptPortfolio(nextPortfolio)}
        />
      ) : null}
      {showGettingStarted ? (
        <WelcomeGettingStartedModal
          portfolio={portfolio}
          showPrivate={showPrivate}
          onEdit={() => setEditorOpen(true)}
          onShowPrivate={() => setShowPrivate(true)}
          onDismiss={() => {
            writeStoredFlag(gettingStartedDismissedKey, true)
            setGettingStartedDismissed(true)
          }}
        />
      ) : null}

      {healthOpen ? (
        <HealthCheckPanel
          health={health}
          loading={healthLoading}
          error={healthError}
          onRefresh={() => void loadHealth()}
          onClose={() => setHealthOpen(false)}
        />
      ) : null}
    </>
  )
}

export default App
