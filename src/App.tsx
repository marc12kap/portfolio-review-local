import { useEffect, useMemo, useState } from 'react'
import { Edit3, Eye, EyeOff, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'

type Settings = {
  accountName: string
  benchmarkName: string
  asOfDate: string
  asOfLabel: string
  periodStart: string
  periodStartLabel: string
  periodEnd: string
  periodEndLabel: string
  accountTotal: number
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
  priceStatus: 'live' | 'fallback' | 'missing'
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

type Portfolio = {
  setupRequired?: false
  settings: Settings
  positions: Position[]
  performance: PerformancePoint[]
  holdings: Holding[]
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
  if (holding.priceStatus === 'fallback') {
    return 'Using the CSV marketValue fallback because a live price was unavailable or quantity was blank.'
  }
  return 'No live price or fallback market value is available for this holding.'
}

function PerformanceChart({
  points,
  finalReturn,
  benchmarkName,
}: {
  points: PerformancePoint[]
  finalReturn: number
  benchmarkName: string
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
          <span><i className="benchmark-key" />{benchmarkName || 'Benchmark'}</span>
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
            As-of date
            <input
              type="date"
              value={settings.asOfDate}
              onChange={(event) => setSettings({ ...settings, asOfDate: event.target.value })}
            />
          </label>
          <label>
            Current book value
            <input
              type="number"
              value={settings.accountTotal}
              onChange={(event) =>
                setSettings({ ...settings, accountTotal: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Beginning of Year Starting Book Value
            <input
              type="number"
              value={settings.baselineInvested}
              onChange={(event) =>
                setSettings({ ...settings, baselineInvested: Number(event.target.value) })
              }
            />
          </label>
        </div>

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
            Enter shares for stock rows and contracts for option rows. Average cost stays optional
            but should be filled in when known.
          </p>
          <div className="editable-table">
            <div className="editable-row editable-head">
              <span>Ticker</span>
              <span>Shares / contracts</span>
              <span>Avg cost</span>
              <span>Type</span>
              <span>Side</span>
              <span>Opt</span>
              <span>Strike</span>
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
                  value={position.quantity}
                  onChange={(event) => updatePosition(position.id, 'quantity', event.target.value)}
                  aria-label="Shares or contracts"
                />
                <input
                  value={position.averageCost}
                  onChange={(event) => updatePosition(position.id, 'averageCost', event.target.value)}
                  aria-label="Average cost"
                  placeholder="per share/contract"
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
                  value={position.strikePrice}
                  onChange={(event) => updatePosition(position.id, 'strikePrice', event.target.value)}
                  aria-label="Strike price"
                  placeholder="-"
                />
                <input
                  type="date"
                  value={position.expiryDate}
                  onChange={(event) => updatePosition(position.id, 'expiryDate', event.target.value)}
                  aria-label="Expiry date"
                />
                <input
                  value={position.premium}
                  onChange={(event) => updatePosition(position.id, 'premium', event.target.value)}
                  aria-label="Premium"
                  placeholder="-"
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

function FirstRunSetup({ onReady }: { onReady: (portfolio: Portfolio) => void }) {
  const [positionsCsv, setPositionsCsv] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function setup(mode: 'demo' | 'blank' | 'import') {
    setSaving(true)
    setError('')
    try {
      const response = await postSetup(mode, positionsCsv)
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
        </div>
        <div className="setup-actions">
          <button type="button" onClick={() => void setup('demo')} disabled={saving}>
            Use Demo Data
          </button>
          <button type="button" onClick={() => void setup('blank')} disabled={saving}>
            Start Blank
          </button>
        </div>
        <label className="csv-import">
          Import positions CSV
          <textarea
            value={positionsCsv}
            onChange={(event) => setPositionsCsv(event.target.value)}
            placeholder="Paste positions.csv contents here"
          />
        </label>
        <button
          className="import-button"
          type="button"
          onClick={() => void setup('import')}
          disabled={saving || !positionsCsv.trim()}
        >
          Import CSV
        </button>
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
  const [showPrivate, setShowPrivate] = useState(false)

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
        setPortfolio(nextPortfolio)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load portfolio.')
    } finally {
      setLoading(false)
    }
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
            setPortfolio(nextPortfolio)
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
      <FirstRunSetup
        onReady={(nextPortfolio) => {
          setSetupRequired(false)
          setPortfolio(nextPortfolio)
        }}
      />
    )
  }

  if (!portfolio) {
    return <LoadErrorState error={error} onRetry={() => void loadPortfolio()} />
  }

  const { settings, metrics } = portfolio
  const hasHoldings = portfolio.holdings.length > 0

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

        <section className="metric-strip" aria-label="Portfolio metrics">
          <div>
            <span>Year-To-Date Return</span>
            <strong className={classNameForReturn(metrics.ytdReturnPercent)}>
              {formatPercent(metrics.ytdReturnPercent, 2)}
            </strong>
            <small>{settings.periodStartLabel} - {settings.periodEndLabel}</small>
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
            Cumulative return, {settings.periodStartLabel} - {settings.periodEndLabel}. Return is
            based on current book value versus starting book value.
          </p>
          <PerformanceChart
            points={portfolio.performance}
            finalReturn={metrics.ytdReturnPercent}
            benchmarkName={settings.benchmarkName}
          />
          <div className="chart-captions">
            <span>{settings.periodStartLabel} - baseline 0%</span>
            <strong>
              {settings.periodEndLabel} -{' '}
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
          onSaved={(nextPortfolio) => setPortfolio(nextPortfolio)}
        />
      ) : null}
    </>
  )
}

export default App
