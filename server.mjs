import { createServer } from 'node:http'
import { copyFile, readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const dataDir = join(root, 'data')
const demoDataDir = join(root, 'demo-data', 'sample')
const logoDir = join(dataDir, 'logos')
const backupDir = join(dataDir, 'backups')
const demoLogoDir = join(demoDataDir, 'logos')
const distDir = join(root, 'dist')
const port = Number(process.env.PORT || 8787)
const priceCache = new Map()
const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function copyIfMissing(sourcePath, targetPath) {
  if (await pathExists(targetPath)) return false
  await copyFile(sourcePath, targetPath)
  return true
}

async function copyReplacing(sourcePath, targetPath) {
  await copyFile(sourcePath, targetPath)
}

async function ensureLocalDataDirectories() {
  await mkdir(dataDir, { recursive: true })
  await mkdir(logoDir, { recursive: true })
}

async function hasLocalPortfolioData() {
  const requiredFiles = ['settings.json', 'positions.csv', 'performance.csv']
  const results = await Promise.all(requiredFiles.map((fileName) => pathExists(join(dataDir, fileName))))
  return results.every(Boolean)
}

async function seedDemoDataFiles({ overwrite = false } = {}) {
  await ensureLocalDataDirectories()
  const copyDataFile = overwrite ? copyReplacing : copyIfMissing

  await Promise.all([
    copyDataFile(join(demoDataDir, 'settings.json'), join(dataDir, 'settings.json')),
    copyDataFile(join(demoDataDir, 'positions.csv'), join(dataDir, 'positions.csv')),
    copyDataFile(join(demoDataDir, 'performance.csv'), join(dataDir, 'performance.csv')),
  ])

  try {
    const demoLogoFiles = await readdir(demoLogoDir)
    await Promise.all(
      demoLogoFiles.map((fileName) =>
        copyDataFile(join(demoLogoDir, fileName), join(logoDir, fileName)),
      ),
    )
  } catch {
    // Demo logos are optional; missing logos can still be fetched and cached on demand.
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function yearStartIso() {
  return `${todayIso().slice(0, 4)}-01-01`
}

function defaultSettings() {
  return {
    accountName: 'Personal Portfolio Book',
    benchmarkName: 'S&P 500',
    benchmarkTicker: 'SPY',
    asOfDate: todayIso(),
    periodStart: yearStartIso(),
    periodEnd: todayIso(),
    accountTotal: 0,
    cashBalance: 0,
    baselineInvested: 0,
  }
}

async function writeBlankDataFiles() {
  await ensureLocalDataDirectories()
  const settings = defaultSettings()
  await Promise.all([
    writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`),
    writeFile(join(dataDir, 'positions.csv'), `${toCsv([])}\n`),
    writeFile(
      join(dataDir, 'performance.csv'),
      `date,returnPct,benchmarkReturnPct\n${settings.periodStart},0,\n${settings.periodEnd},0,\n`,
    ),
  ])
}

async function initializePortfolioData(payload) {
  const mode = String(payload?.mode || '')

  if (mode === 'demo') {
    await seedDemoDataFiles()
    return
  }

  if (mode === 'blank') {
    await writeBlankDataFiles()
    return
  }

  if (mode === 'import') {
    const positions = parseCsv(String(payload?.positionsCsv || ''))
    validatePositions(positions)
    await writeBlankDataFiles()
    await writeFile(join(dataDir, 'positions.csv'), `${toCsv(positions)}\n`)
    return
  }

  throw validationError('Setup validation failed.', [
    'Choose demo, blank, or import setup mode.',
  ])
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function backupLocalDataFile(fileName) {
  const sourcePath = join(dataDir, fileName)
  if (!(await pathExists(sourcePath))) return

  await mkdir(backupDir, { recursive: true })
  const extension = extname(fileName)
  const baseName = fileName.slice(0, -extension.length)
  await copyFile(sourcePath, join(backupDir, `${baseName}-${backupTimestamp()}${extension}`))
}

async function backupLocalDataFiles() {
  await Promise.all([
    backupLocalDataFile('settings.json'),
    backupLocalDataFile('positions.csv'),
    backupLocalDataFile('performance.csv'),
  ])
}

async function resetPortfolioData(payload) {
  const mode = String(payload?.mode || '')

  if (!['demo', 'blank'].includes(mode)) {
    throw validationError('Reset validation failed.', ['Choose demo or blank reset mode.'])
  }

  await ensureLocalDataDirectories()
  await backupLocalDataFiles()
  await rm(logoDir, { recursive: true, force: true })
  await mkdir(logoDir, { recursive: true })

  if (mode === 'demo') {
    await seedDemoDataFiles({ overwrite: true })
    return
  }

  await writeBlankDataFiles()
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_500_000) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolveBody(body ? JSON.parse(body) : {})
      } catch {
        reject(validationError('Request body must be valid JSON.', ['Check the request JSON syntax.']))
      }
    })
    request.on('error', reject)
  })
}

function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      field += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((value) => value.trim() !== '')) rows.push(row)

  const [headers = [], ...records] = rows
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])),
  )
}

function escapeCsvValue(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(rows) {
  const headers = [
    'id',
    'ticker',
    'company',
    'underlying',
    'assetType',
    'side',
    'quantity',
    'averageCost',
    'multiplier',
    'marketValue',
    'optionType',
    'strikePrice',
    'expiryDate',
    'premium',
    'sector',
    'structure',
    'logoUrl',
  ]
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(String(value).replace(/[$,%\s,]/g, ''))
  return Number.isFinite(numeric) ? numeric : fallback
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function hasNumericValue(value) {
  if (value === null || value === undefined || value === '') return false
  return Number.isFinite(Number(String(value).replace(/[$,%\s,]/g, '')))
}

function normalizeNumericValue(value) {
  if (!hasNumericValue(value)) return ''
  return String(toNumber(value))
}

function normalizePositionForSave(position) {
  const numericFields = ['quantity', 'averageCost', 'multiplier', 'marketValue', 'strikePrice', 'premium']
  return {
    ...position,
    ...Object.fromEntries(
      numericFields.map((field) => [field, normalizeNumericValue(position?.[field])]),
    ),
  }
}

function isValidIsoDate(value) {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

function formatIsoDate(value) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

function prettyDate(value) {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function cleanTicker(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

function cleanBenchmarkTicker(value) {
  return cleanTicker(value || 'SPY') || 'SPY'
}

function normalizeLogoTicker(value) {
  return cleanTicker(value).replace(/[^A-Z0-9.-]/g, '')
}

function validationError(message, errors) {
  const error = new Error(message)
  error.statusCode = 400
  error.validationErrors = errors
  return error
}

function validateSettings(payload) {
  const errors = []
  const numericFields = [
    ['accountTotal', 'Current book value'],
    ['cashBalance', 'Available cash'],
    ['baselineInvested', 'Beginning book value'],
  ]

  for (const [field, label] of numericFields) {
    if (payload?.[field] !== undefined && !hasNumericValue(payload?.[field])) {
      errors.push(`${label} must be a number.`)
    }
  }

  for (const [field, label] of [
    ['asOfDate', 'As-of date'],
    ['periodStart', 'Period start date'],
    ['periodEnd', 'Period end date'],
  ]) {
    if (!isValidIsoDate(payload?.[field])) errors.push(`${label} must be a YYYY-MM-DD date.`)
  }

  if (errors.length) throw validationError('Settings validation failed.', errors)
}

function validatePositions(positions) {
  const errors = []

  if (!Array.isArray(positions)) {
    throw validationError('Positions validation failed.', ['Positions must be an array.'])
  }

  positions.forEach((position, index) => {
    const rowNumber = index + 1
    const ticker = cleanTicker(position?.ticker)
    const underlying = cleanTicker(position?.underlying || position?.ticker)
    const assetType = String(position?.assetType || 'stock')
    const side = String(position?.side || 'long')
    const optionType = String(position?.optionType || '')

    if (!ticker) errors.push(`Row ${rowNumber}: ticker is required.`)
    if (!underlying) errors.push(`Row ${rowNumber}: underlying ticker is required.`)
    if (!['stock', 'option', 'spread', 'cash'].includes(assetType)) {
      errors.push(`Row ${rowNumber}: asset type must be stock, option, spread, or cash.`)
    }
    if (!['long', 'short'].includes(side)) errors.push(`Row ${rowNumber}: side must be long or short.`)
    if (optionType && !['call', 'put'].includes(optionType)) {
      errors.push(`Row ${rowNumber}: option type must be call or put.`)
    }

    for (const [field, label] of [
      ['quantity', 'quantity'],
      ['averageCost', 'average cost'],
      ['multiplier', 'multiplier'],
      ['marketValue', 'market value'],
      ['strikePrice', 'strike price'],
      ['premium', 'premium'],
    ]) {
      if (position?.[field] !== '' && position?.[field] !== undefined && !hasNumericValue(position[field])) {
        errors.push(`Row ${rowNumber}: ${label} must be numeric when filled.`)
      }
    }

    if (!hasNumericValue(position?.quantity) && !hasNumericValue(position?.marketValue)) {
      errors.push(`Row ${rowNumber}: enter quantity or fallback market value.`)
    }

    if (!isValidIsoDate(position?.expiryDate)) {
      errors.push(`Row ${rowNumber}: expiry date must be a YYYY-MM-DD date.`)
    }
  })

  if (errors.length) throw validationError('Positions validation failed.', errors)
}

function logoContentTypeForExtension(extension) {
  return mimeTypes[extension] || 'application/octet-stream'
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase()
  if (normalized.includes('image/svg')) return '.svg'
  if (normalized.includes('image/png')) return '.png'
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg'
  if (normalized.includes('image/webp')) return '.webp'
  if (normalized.includes('image/x-icon') || normalized.includes('image/vnd.microsoft.icon')) return '.ico'
  return ''
}

function extractDomain(value) {
  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'logo.clearbit.com') {
      return parsed.pathname.replace(/^\//, '').split('/')[0]
    }
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function logoCandidatesForPosition(position) {
  const candidates = []
  const domain = extractDomain(position.logoUrl)

  if (position.logoUrl && /^https:\/\//i.test(position.logoUrl)) {
    candidates.push(position.logoUrl)
  }

  if (domain) {
    candidates.push(`https://logo.clearbit.com/${domain}`)
    candidates.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
  }

  return [...new Set(candidates)]
}

async function findCachedLogo(ticker) {
  for (const extension of ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico']) {
    const filePath = join(logoDir, `${ticker}${extension}`)
    try {
      await stat(filePath)
      return {
        filePath,
        contentType: logoContentTypeForExtension(extension),
      }
    } catch {
      // Keep looking.
    }
  }
  return null
}

async function fetchLogo(position) {
  await ensureLocalDataDirectories()
  const ticker = normalizeLogoTicker(position.underlying || position.ticker)
  const cached = await findCachedLogo(ticker)
  if (cached) return cached

  for (const candidate of logoCandidatesForPosition(position)) {
    try {
      const response = await fetch(candidate, {
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'user-agent': 'Mozilla/5.0 PortfolioReviewLocal/1.0',
        },
        signal: AbortSignal.timeout(8000),
      })
      const contentType = response.headers.get('content-type') || ''
      const extension = extensionForContentType(contentType)
      if (!response.ok || !extension) continue

      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length < 100) continue

      const filePath = join(logoDir, `${ticker}${extension}`)
      await writeFile(filePath, bytes)
      return {
        filePath,
        contentType: logoContentTypeForExtension(extension),
      }
    } catch {
      // Try the next source.
    }
  }

  return null
}

async function readSettings() {
  const raw = await readFile(join(dataDir, 'settings.json'), 'utf8')
  const settings = JSON.parse(raw)
  return {
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    asOfDate: formatIsoDate(settings.asOfDate),
    periodStart: formatIsoDate(settings.periodStart),
    periodEnd: formatIsoDate(settings.periodEnd),
    accountTotal: toNumber(settings.accountTotal),
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : null,
    baselineInvested: toNumber(settings.baselineInvested),
  }
}

async function readPositions() {
  const raw = await readFile(join(dataDir, 'positions.csv'), 'utf8')
  return parseCsv(raw).map((row, index) => ({
    id: row.id || String(index + 1),
    ticker: cleanTicker(row.ticker),
    company: row.company || cleanTicker(row.ticker),
    underlying: cleanTicker(row.underlying || row.ticker),
    assetType: row.assetType || 'stock',
    side: row.side === 'short' ? 'short' : 'long',
    quantity: row.quantity || '',
    averageCost: row.averageCost || '',
    multiplier: row.multiplier || '',
    marketValue: row.marketValue || '',
    optionType: row.optionType || '',
    strikePrice: row.strikePrice || '',
    expiryDate: row.expiryDate || '',
    premium: row.premium || '',
    sector: row.sector || 'Other',
    structure: row.structure || '',
    logoUrl: row.logoUrl || '',
  }))
}

async function readPerformance(settings) {
  try {
    const raw = await readFile(join(dataDir, 'performance.csv'), 'utf8')
    const points = parseCsv(raw)
      .map((row) => ({
        date: formatIsoDate(row.date),
        returnPct: toNumber(row.returnPct),
        benchmarkReturnPct: hasNumericValue(row.benchmarkReturnPct)
          ? toNumber(row.benchmarkReturnPct)
          : null,
      }))
      .filter((point) => point.date)
    if (points.length > 1) return points
  } catch {
    // Fall through to a generated curve.
  }

  return [
    { date: settings.periodStart, returnPct: 0, benchmarkReturnPct: null },
    { date: settings.periodEnd || settings.asOfDate, returnPct: 0, benchmarkReturnPct: null },
  ]
}

async function fetchYahooChartPrices(tickers) {
  if (tickers.length === 0) return {}

  const now = Date.now()
  const prices = {}
  const misses = tickers.filter((ticker) => {
    const cached = priceCache.get(ticker)
    if (cached && now - cached.fetchedAt < 10 * 60 * 1000) {
      prices[ticker] = cached
      return false
    }
    return true
  })

  await Promise.all(
    misses.map(async (ticker) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        ticker,
      )}?range=1d&interval=1d`
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 PortfolioReviewLocal/1.0',
        },
      })

      if (!response.ok) return
      const payload = await response.json()
      const meta = payload?.chart?.result?.[0]?.meta
      const price = toNumber(meta?.regularMarketPrice || meta?.previousClose)
      if (price > 0) {
        const record = {
          price,
          source: 'Yahoo Finance chart',
          fetchedAt: now,
        }
        priceCache.set(ticker, record)
        prices[ticker] = record
      }
    }),
  )

  return prices
}

async function fetchStooqPrices(tickers) {
  const result = {}
  await Promise.all(
    tickers.map(async (ticker) => {
      const symbol = `${ticker.toLowerCase()}.us`
      const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2c&h&e=csv`
      const response = await fetch(url, { headers: { accept: 'text/csv' } })
      if (!response.ok) return
      const [row] = parseCsv(await response.text())
      const price = toNumber(row?.Close)
      if (price > 0) {
        result[ticker] = {
          price,
          source: 'Stooq',
          fetchedAt: Date.now(),
        }
      }
    }),
  )
  return result
}

async function fetchPrices(tickers) {
  const uniqueTickers = [...new Set(tickers.map(cleanTicker).filter(Boolean))]
  try {
    const yahoo = await fetchYahooChartPrices(uniqueTickers)
    const missing = uniqueTickers.filter((ticker) => !yahoo[ticker])
    if (missing.length === 0) return yahoo
    return { ...yahoo, ...(await fetchStooqPrices(missing)) }
  } catch (error) {
    const stooq = await fetchStooqPrices(uniqueTickers)
    return Object.assign(stooq, {
      _error: error instanceof Error ? error.message : 'Price fetch failed.',
    })
  }
}

function inferStructure(rows, fallback) {
  if (rows.length === 1 && fallback) return fallback
  const hasStock = rows.some((row) => row.assetType === 'stock')
  const hasLongCall = rows.some(
    (row) => (row.assetType === 'call' || row.optionType === 'call') && row.side !== 'short',
  )
  const hasShortCall = rows.some(
    (row) => (row.assetType === 'call' || row.optionType === 'call') && row.side === 'short',
  )
  const hasLongPut = rows.some(
    (row) => (row.assetType === 'put' || row.optionType === 'put') && row.side !== 'short',
  )
  const hasShortPut = rows.some(
    (row) => (row.assetType === 'put' || row.optionType === 'put') && row.side === 'short',
  )
  const hasSpread = rows.some((row) => row.assetType.includes('spread'))

  if (hasStock && hasShortCall) return 'Common shares with covered calls'
  if (hasStock && hasLongCall) return 'Common shares with long calls'
  if (hasStock && (hasLongPut || hasShortPut)) return 'Common shares with option overlay'
  if (hasSpread) return 'Long call spread'
  if (hasLongCall) return 'Long call position'
  if (hasLongPut) return 'Long put position'
  if (fallback) return fallback
  return 'Common shares'
}

function isOptionLike(position) {
  return ['option', 'spread'].includes(position.assetType) || ['call', 'put'].includes(position.optionType)
}

function consolidatePositions(positions, prices, settings) {
  const grouped = new Map()
  const optionExposureMap = new Map()
  const priceIssues = []

  for (const [index, position] of positions.entries()) {
    const underlying = cleanTicker(position.underlying || position.ticker)
    if (!underlying) continue

    const price = prices[underlying]?.price
    const priceRecord = prices[underlying]
    const quantity = toNumber(position.quantity)
    const hasQuantity = hasNumericValue(position.quantity) && quantity !== 0
    const hasFallbackMarketValue = hasNumericValue(position.marketValue)
    const multiplier = toNumber(
      position.multiplier,
      position.assetType === 'stock' || position.assetType === 'cash' ? 1 : 100,
    )
    const sideSign = position.side === 'short' ? -1 : 1
    const marketValue = toNumber(position.marketValue)
    const usesLivePrice = Boolean(price && hasQuantity)
    const computedValue = usesLivePrice ? sideSign * quantity * multiplier * price : marketValue
    const optionType = ['call', 'put'].includes(position.optionType) ? position.optionType : 'option'

    if (hasQuantity && !price && !hasFallbackMarketValue) {
      priceIssues.push({
        rowNumber: index + 1,
        ticker: position.ticker || underlying,
        underlying,
        company: position.company || underlying,
        quantity,
        assetType: position.assetType || 'stock',
        message: 'No live price was found and no fallback market value is set.',
      })
    }

    if (!grouped.has(underlying)) {
      grouped.set(underlying, {
        ticker: underlying,
        company: position.company || underlying,
        sector: position.sector || 'Other',
        structure: position.structure || '',
        logoUrl: position.logoUrl,
        value: 0,
        rows: [],
        price: price || null,
        priceSource: priceRecord?.source || '',
        priceFetchedAt: priceRecord?.fetchedAt || null,
        priceStatus: 'missing',
      })
    }

    const item = grouped.get(underlying)
    item.value += computedValue
    item.rows.push(position)
    if (!item.logoUrl && position.logoUrl) item.logoUrl = position.logoUrl
    if (!item.structure && position.structure) item.structure = position.structure
    if (usesLivePrice) {
      item.priceStatus = 'live'
    } else if (hasFallbackMarketValue && item.priceStatus !== 'live') {
      item.priceStatus = 'fallback'
    }

    if (isOptionLike(position)) {
      if (!optionExposureMap.has(underlying)) {
        optionExposureMap.set(underlying, {
          ticker: underlying,
          value: 0,
          legCount: 0,
          callCount: 0,
          putCount: 0,
          spreadCount: 0,
          netContracts: 0,
          expirations: new Set(),
        })
      }

      const exposure = optionExposureMap.get(underlying)
      exposure.value += computedValue
      exposure.legCount += 1
      exposure.netContracts += sideSign * quantity
      if (optionType === 'call') exposure.callCount += 1
      if (optionType === 'put') exposure.putCount += 1
      if (position.assetType === 'spread') exposure.spreadCount += 1
      if (position.expiryDate) exposure.expirations.add(position.expiryDate)
    }
  }

  const rawHoldings = [...grouped.values()].filter((holding) => Math.abs(holding.value) > 0.01)
  const investedValue = rawHoldings.reduce((sum, holding) => sum + holding.value, 0)
  const hasCashBalance = hasNumericValue(settings.cashBalance)
  const legacyAccountTotal = settings.accountTotal > 0 ? settings.accountTotal : investedValue
  const cashValue = roundCurrency(
    hasCashBalance
      ? Math.max(toNumber(settings.cashBalance), 0)
      : Math.max(legacyAccountTotal - investedValue, 0),
  )
  const accountTotal = roundCurrency(hasCashBalance ? investedValue + cashValue : legacyAccountTotal)
  const baselineInvested = settings.baselineInvested > 0 ? settings.baselineInvested : accountTotal
  const ytdReturnPercent = baselineInvested
    ? ((accountTotal - baselineInvested) / baselineInvested) * 100
    : 0

  const holdings = rawHoldings
    .map((holding) => ({
      ticker: holding.ticker,
      company: holding.company,
      sector: holding.sector,
      structure: inferStructure(holding.rows, holding.structure),
      logoUrl: holding.logoUrl,
      value: holding.value,
      weight: accountTotal ? (holding.value / accountTotal) * 100 : 0,
      price: holding.price,
      priceSource: holding.priceSource,
      priceFetchedAt: holding.priceFetchedAt,
      priceStatus: holding.priceStatus,
    }))
    .sort((left, right) => right.weight - left.weight)

  const sectorMap = new Map()
  for (const holding of holdings) {
    sectorMap.set(holding.sector, (sectorMap.get(holding.sector) || 0) + holding.weight)
  }

  const sectors = [...sectorMap.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((left, right) => right.weight - left.weight)

  if (cashValue > 0 || accountTotal > 0) {
    sectors.push({ name: 'Cash & Equivalents', weight: accountTotal ? (cashValue / accountTotal) * 100 : 0 })
  }

  const cashWeight = accountTotal ? (cashValue / accountTotal) * 100 : 0
  const netInvestedPercent = Math.max(0, 100 - cashWeight)
  const topFiveConcentration = holdings
    .slice(0, 5)
    .reduce((sum, holding) => sum + Math.max(0, holding.weight), 0)
  const topHoldingWeight = Math.max(0, holdings[0]?.weight || 0)

  return {
    holdings,
    priceIssues,
    optionExposures: [...optionExposureMap.values()]
      .map((exposure) => ({
        ticker: exposure.ticker,
        value: exposure.value,
        weight: accountTotal ? (exposure.value / accountTotal) * 100 : 0,
        legCount: exposure.legCount,
        callCount: exposure.callCount,
        putCount: exposure.putCount,
        spreadCount: exposure.spreadCount,
        netContracts: exposure.netContracts,
        expirations: [...exposure.expirations].sort(),
      }))
      .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight)),
    sectors,
    metrics: {
      accountTotal,
      investedValue,
      cashValue,
      baselineInvested,
      cashWeight,
      netInvestedPercent,
      diversificationSectors: sectors.filter((sector) => sector.name !== 'Cash & Equivalents').length,
      underlyingCount: holdings.length,
      topFiveConcentration,
      topHoldingWeight,
      ytdReturnPercent,
    },
  }
}

async function buildPortfolio() {
  if (!(await hasLocalPortfolioData())) {
    return { setupRequired: true }
  }
  const [settings, positions] = await Promise.all([readSettings(), readPositions()])
  const tickers = positions.map((position) => position.underlying || position.ticker)
  const prices = await fetchPrices(tickers)
  const basePerformance = await readPerformance(settings)
  const consolidated = consolidatePositions(positions, prices, settings)
  const performance = basePerformance.map((point, index) =>
    index === basePerformance.length - 1
      ? { ...point, returnPct: consolidated.metrics.ytdReturnPercent }
      : point,
  )
  return {
    settings: {
      ...settings,
      accountTotal: consolidated.metrics.accountTotal,
      cashBalance: consolidated.metrics.cashValue,
      asOfLabel: prettyDate(settings.asOfDate),
      periodStartLabel: prettyDate(settings.periodStart),
      periodEndLabel: prettyDate(settings.periodEnd || settings.asOfDate),
    },
    positions,
    performance,
    prices,
    ...consolidated,
  }
}

async function saveSettings(payload) {
  await ensureLocalDataDirectories()
  validateSettings(payload)
  await backupLocalDataFile('settings.json')
  const next = {
    accountName: payload.accountName || 'Personal Portfolio Book',
    benchmarkName: payload.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(payload.benchmarkTicker),
    asOfDate: formatIsoDate(payload.asOfDate),
    periodStart: formatIsoDate(payload.periodStart),
    periodEnd: formatIsoDate(payload.periodEnd),
    accountTotal: toNumber(payload.accountTotal),
    cashBalance: hasNumericValue(payload.cashBalance) ? toNumber(payload.cashBalance) : null,
    baselineInvested: toNumber(payload.baselineInvested),
  }
  await writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(next, null, 2)}\n`)
}

async function savePositions(positions) {
  await ensureLocalDataDirectories()
  validatePositions(positions)
  await backupLocalDataFile('positions.csv')
  const rows = Array.isArray(positions) ? positions.map(normalizePositionForSave) : []
  await writeFile(join(dataDir, 'positions.csv'), `${toCsv(rows)}\n`)
}

async function savePortfolio(payload) {
  await ensureLocalDataDirectories()
  const settings = payload?.settings || {}
  const positions = payload?.positions
  validateSettings(settings)
  validatePositions(positions)
  await backupLocalDataFile('settings.json')
  await backupLocalDataFile('positions.csv')
  const nextSettings = {
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    asOfDate: formatIsoDate(settings.asOfDate),
    periodStart: formatIsoDate(settings.periodStart),
    periodEnd: formatIsoDate(settings.periodEnd),
    accountTotal: toNumber(settings.accountTotal),
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : null,
    baselineInvested: toNumber(settings.baselineInvested),
  }
  await Promise.all([
    writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(nextSettings, null, 2)}\n`),
    writeFile(join(dataDir, 'positions.csv'), `${toCsv(positions.map(normalizePositionForSave))}\n`),
  ])
}

async function serveStatic(request, response) {
  const parsedUrl = new URL(request.url, `http://${request.headers.host}`)
  const requestedPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname
  const safePath = resolve(distDir, `.${decodeURIComponent(requestedPath)}`)
  const safeRoot = resolve(distDir)

  if (!safePath.startsWith(safeRoot)) {
    response.writeHead(403)
    response.end('Forbidden')
    return
  }

  let filePath = safePath
  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(distDir, 'index.html')
  }

  const extension = extname(filePath)
  response.writeHead(200, {
    'content-type': mimeTypes[extension] || 'application/octet-stream',
  })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)

    if (url.pathname === '/api/portfolio' && request.method === 'GET') {
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/portfolio' && request.method === 'PUT') {
      const body = await readBody(request)
      await savePortfolio(body)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/setup' && request.method === 'POST') {
      const body = await readBody(request)
      await initializePortfolioData(body)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/reset' && request.method === 'POST') {
      const body = await readBody(request)
      await resetPortfolioData(body)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/positions' && request.method === 'PUT') {
      const body = await readBody(request)
      await savePositions(body.positions)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/settings' && request.method === 'PUT') {
      const body = await readBody(request)
      await saveSettings(body.settings || body)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/positions.csv' && request.method === 'GET') {
      if (!(await hasLocalPortfolioData())) {
        sendJson(response, 404, { error: 'Local portfolio data has not been set up yet.' })
        return
      }
      const raw = await readFile(join(dataDir, 'positions.csv'), 'utf8')
      response.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(raw)
      return
    }

    const logoMatch = url.pathname.match(/^\/api\/logo\/([^/]+)$/)
    if (logoMatch && request.method === 'GET') {
      if (!(await hasLocalPortfolioData())) {
        sendJson(response, 404, { error: 'Local portfolio data has not been set up yet.' })
        return
      }
      const ticker = normalizeLogoTicker(decodeURIComponent(logoMatch[1]))
      const positions = await readPositions()
      const position = positions.find((row) => row.underlying === ticker || row.ticker === ticker)
      if (!position) {
        sendJson(response, 404, { error: 'Logo ticker not found.' })
        return
      }

      const logo = await fetchLogo(position)
      if (!logo) {
        sendJson(response, 404, { error: 'Logo unavailable.' })
        return
      }

      response.writeHead(200, {
        'content-type': logo.contentType,
        'cache-control': 'public, max-age=604800',
      })
      createReadStream(logo.filePath).pipe(response)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' })
      return
    }

    await serveStatic(request, response)
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
      validationErrors: Array.isArray(error?.validationErrors) ? error.validationErrors : undefined,
    })
  }
})

export { cleanBenchmarkTicker, consolidatePositions, inferStructure, validatePositions, validateSettings }

if (isMainModule) {
  await ensureLocalDataDirectories()

  server.listen(port, '127.0.0.1', () => {
    console.log(`Portfolio Review is running at http://127.0.0.1:${port}`)
  })
}
