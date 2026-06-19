import { createServer } from 'node:http'
import { copyFile, readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const dataDir = join(root, 'data')
const demoDataDir = join(root, 'demo-data', 'sample')
const logoDir = join(dataDir, 'logos')
const priceCacheFile = join(dataDir, 'price-cache.json')
const sourceFile = join(dataDir, 'source.json')
const demoLogoDir = join(demoDataDir, 'logos')
const distDir = join(root, 'dist')
const port = Number(process.env.PORT || 8787)
const currentSchemaVersion = 1
const reportingTimeZone = 'America/New_York'
const priceCache = new Map()
const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
const appVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version || '0.0.0'
const restorableDataFiles = [
  { fileType: 'settings', targetFileName: 'settings.json', baseName: 'settings', extension: '.json', label: 'Settings' },
  { fileType: 'positions', targetFileName: 'positions.csv', baseName: 'positions', extension: '.csv', label: 'Positions' },
  {
    fileType: 'performance',
    targetFileName: 'performance.csv',
    baseName: 'performance',
    extension: '.csv',
    label: 'Performance',
  },
  { fileType: 'source', targetFileName: 'source.json', baseName: 'source', extension: '.json', label: 'Source metadata' },
  { fileType: 'schema', targetFileName: 'schema.json', baseName: 'schema', extension: '.json', label: 'Schema metadata' },
]

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

async function hasLocalPortfolioDataIn(baseDir = dataDir) {
  const requiredFiles = ['settings.json', 'positions.csv', 'performance.csv']
  const results = await Promise.all(requiredFiles.map((fileName) => pathExists(join(baseDir, fileName))))
  return results.every(Boolean)
}

async function hasLocalPortfolioData() {
  return hasLocalPortfolioDataIn(dataDir)
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
  await refreshLocalSettingsReportingDates()
  await writePortfolioSource('demo')
  await writeSchemaMetadata(dataDir, {
    migrations: [
      {
        version: currentSchemaVersion,
        appliedAt: new Date().toISOString(),
        changes: ['Seeded demo data with current schema.'],
      },
    ],
  })
}

async function refreshLocalSettingsReportingDates(baseDir = dataDir) {
  const filePath = join(baseDir, 'settings.json')
  if (!(await pathExists(filePath))) return

  const settings = JSON.parse(await readFile(filePath, 'utf8'))
  await writeFile(
    filePath,
    `${JSON.stringify({ ...settings, ...normalizeReportingDates(settings) }, null, 2)}\n`,
  )
}

function isoDateInTimeZone(date = new Date(), timeZone = reportingTimeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function todayIso() {
  return isoDateInTimeZone()
}

function yearStartIso(today = todayIso()) {
  return `${today.slice(0, 4)}-01-01`
}

function yearStartReviewForSettings(settings, today = todayIso()) {
  const currentYear = today.slice(0, 4)
  const currentYearStart = `${currentYear}-01-01`
  const periodStart = formatIsoDate(settings?.periodStart)
  const periodStartYear = periodStart ? periodStart.slice(0, 4) : null
  return {
    required: Boolean(periodStartYear && periodStartYear !== currentYear),
    currentYear,
    currentYearStart,
    periodStart: periodStart || null,
    periodStartYear,
  }
}

function normalizeReportingDates(settings, today = todayIso()) {
  const todayValue = formatIsoDate(today)
  const yearStart = `${todayValue.slice(0, 4)}-01-01`
  const periodStart = formatIsoDate(settings?.periodStart) || yearStart

  return {
    asOfDate: todayValue,
    periodStart: periodStart > todayValue ? yearStart : periodStart,
    periodEnd: todayValue,
  }
}

function defaultSettings() {
  const today = todayIso()
  return {
    accountName: 'Personal Portfolio Book',
    benchmarkName: 'S&P 500',
    benchmarkTicker: 'SPY',
    asOfDate: today,
    periodStart: yearStartIso(today),
    periodEnd: today,
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
  await writeSchemaMetadata(dataDir, {
    migrations: [
      {
        version: currentSchemaVersion,
        appliedAt: new Date().toISOString(),
        changes: ['Created blank local data with current schema.'],
      },
    ],
  })
}

async function writePortfolioSource(kind) {
  await ensureLocalDataDirectories()
  const source = kind === 'demo' ? 'demo' : 'user'
  await writeFile(
    sourceFile,
    `${JSON.stringify({ source, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

async function readPortfolioSource(settings = null) {
  try {
    const raw = await readFile(sourceFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.source === 'demo') return { source: 'demo', isDemo: true }
    if (parsed?.source === 'user') return { source: 'user', isDemo: false }
  } catch {
    // Older local data may predate explicit source metadata.
  }

  if ((settings?.accountName || '').toLowerCase().includes('sample investment portfolio')) {
    return { source: 'demo', isDemo: true }
  }

  return { source: 'user', isDemo: false }
}

async function readPortfolioSourceMetadata(baseDir = dataDir) {
  try {
    const raw = await readFile(join(baseDir, 'source.json'), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.source === 'demo') return { source: 'demo', isDemo: true, updatedAt: parsed.updatedAt || null }
    if (parsed?.source === 'user') return { source: 'user', isDemo: false, updatedAt: parsed.updatedAt || null }
    return { source: 'unknown', isDemo: false, updatedAt: null }
  } catch {
    return { source: 'missing', isDemo: false, updatedAt: null }
  }
}

async function initializePortfolioData(payload) {
  const mode = String(payload?.mode || '')

  if (mode === 'demo') {
    await seedDemoDataFiles()
    return
  }

  if (mode === 'blank') {
    await writeBlankDataFiles()
    await writePortfolioSource('user')
    return
  }

  if (mode === 'import') {
    const positions = parseCsv(String(payload?.positionsCsv || ''))
    validatePositions(positions)
    await writeBlankDataFiles()
    await writeFile(join(dataDir, 'positions.csv'), `${toCsv(positions)}\n`)
    await writePortfolioSource('user')
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
  return backupLocalDataFileIn(dataDir, fileName)
}

async function backupLocalDataFileIn(baseDir, fileName) {
  const sourcePath = join(baseDir, fileName)
  if (!(await pathExists(sourcePath))) return null

  const targetBackupDir = join(baseDir, 'backups')
  await mkdir(targetBackupDir, { recursive: true })
  const extension = extname(fileName)
  const baseName = fileName.slice(0, -extension.length)
  const backupFileName = `${baseName}-${backupTimestamp()}${extension}`
  await copyFile(sourcePath, join(targetBackupDir, backupFileName))
  return backupFileName
}

async function backupLocalDataFiles() {
  await Promise.all([
    backupLocalDataFile('settings.json'),
    backupLocalDataFile('positions.csv'),
    backupLocalDataFile('performance.csv'),
    backupLocalDataFile('source.json'),
    backupLocalDataFile('schema.json'),
  ])
}

function parseBackupTimestamp(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second, ms] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function backupMetadataForFileName(fileName, fileStat = null) {
  if (fileName.includes('/') || fileName.includes('\\')) return null

  for (const target of restorableDataFiles) {
    const prefix = `${target.baseName}-`
    if (!fileName.startsWith(prefix) || !fileName.endsWith(target.extension)) continue

    const rawTimestamp = fileName.slice(prefix.length, fileName.length - target.extension.length)
    const createdAt = parseBackupTimestamp(rawTimestamp)
    if (!createdAt) continue

    return {
      fileName,
      fileType: target.fileType,
      targetFileName: target.targetFileName,
      label: target.label,
      createdAt,
      sizeBytes: fileStat?.size || 0,
    }
  }

  return null
}

async function listLocalBackups(baseDir = dataDir) {
  const targetBackupDir = join(baseDir, 'backups')
  if (!(await pathExists(targetBackupDir))) return []

  const fileNames = await readdir(targetBackupDir)
  const backups = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = join(targetBackupDir, fileName)
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat?.isFile()) return null
      return backupMetadataForFileName(fileName, fileStat)
    }),
  )

  return backups
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.fileName.localeCompare(right.fileName))
}

function validateJsonObjectBackup(raw, label) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw validationError('Backup restore failed.', [`${label} backup is not valid JSON.`])
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw validationError('Backup restore failed.', [`${label} backup must be a JSON object.`])
  }
  return parsed
}

function validateBackupContent(info, raw) {
  if (info.fileType === 'settings') {
    validateSettings(validateJsonObjectBackup(raw, info.label))
    return
  }

  if (info.fileType === 'positions') {
    validatePositions(parseCsv(raw))
    return
  }

  if (info.fileType === 'performance') {
    parsePerformancePreview(raw)
    return
  }

  validateJsonObjectBackup(raw, info.label)
}

async function restoreLocalBackup(payload, baseDir = dataDir) {
  const fileName = String(payload?.fileName || '')
  const backups = await listLocalBackups(baseDir)
  const backup = backups.find((candidate) => candidate.fileName === fileName)

  if (!backup) {
    throw validationError('Backup restore failed.', ['Choose a backup file from data/backups.'])
  }

  const targetBackupDir = resolve(baseDir, 'backups')
  const backupPath = resolve(targetBackupDir, backup.fileName)
  const targetPath = resolve(baseDir, backup.targetFileName)
  const safeBaseDir = resolve(baseDir)

  if (!backupPath.startsWith(targetBackupDir) || !targetPath.startsWith(safeBaseDir)) {
    throw validationError('Backup restore failed.', ['Backup path is outside the local data folder.'])
  }

  validateBackupContent(backup, await readFile(backupPath, 'utf8'))
  const currentBackupFileName = await backupLocalDataFileIn(baseDir, backup.targetFileName)
  await copyFile(backupPath, targetPath)

  if (await hasLocalPortfolioDataIn(baseDir)) await migrateLocalDataFiles(baseDir)

  return {
    restored: backup,
    currentBackupFileName,
  }
}

async function statLocalFile(baseDir, fileName) {
  const filePath = join(baseDir, fileName)
  const fileStat = await stat(filePath).catch(() => null)
  return {
    fileName,
    exists: Boolean(fileStat?.isFile()),
    sizeBytes: fileStat?.isFile() ? fileStat.size : 0,
    updatedAt: fileStat?.isFile() ? fileStat.mtime.toISOString() : null,
  }
}

function summarizePriceCache(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      exists: true,
      ok: false,
      recordCount: 0,
      newestFetchedAt: null,
      message: 'Price cache exists but is not valid JSON.',
    }
  }

  const records = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.values(parsed) : []
  const timestamps = records
    .map((record) => Number(record?.fetchedAt))
    .filter((fetchedAt) => Number.isFinite(fetchedAt) && fetchedAt > 0)
  const newestFetchedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null

  return {
    exists: true,
    ok: true,
    recordCount: records.length,
    newestFetchedAt,
    message: records.length ? 'Last-known price cache is available.' : 'Price cache is empty.',
  }
}

async function readPriceCacheHealth(baseDir = dataDir) {
  const filePath = join(baseDir, 'price-cache.json')
  if (!(await pathExists(filePath))) {
    return {
      exists: false,
      ok: true,
      recordCount: 0,
      newestFetchedAt: null,
      message: 'No last-known price cache yet. It will be created after successful price lookups.',
    }
  }
  return summarizePriceCache(await readFile(filePath, 'utf8'))
}

async function readSchemaHealth(baseDir = dataDir) {
  const filePath = join(baseDir, 'schema.json')
  if (!(await pathExists(filePath))) {
    return {
      exists: false,
      ok: false,
      version: null,
      currentVersion: currentSchemaVersion,
      migrationCount: 0,
      latestMigrationAt: null,
      message: 'Schema metadata is missing. Setup or migration will recreate it.',
    }
  }

  try {
    const metadata = JSON.parse(await readFile(filePath, 'utf8'))
    const migrations = Array.isArray(metadata?.migrations) ? metadata.migrations : []
    const latestMigrationAt = migrations
      .map((migration) => migration?.appliedAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null

    return {
      exists: true,
      ok: metadata?.version === currentSchemaVersion,
      version: Number.isInteger(metadata?.version) ? metadata.version : null,
      currentVersion: currentSchemaVersion,
      migrationCount: migrations.length,
      latestMigrationAt,
      message:
        metadata?.version === currentSchemaVersion
          ? 'Local schema metadata is current.'
          : 'Local schema metadata is missing or older than the app expects.',
    }
  } catch {
    return {
      exists: true,
      ok: false,
      version: null,
      currentVersion: currentSchemaVersion,
      migrationCount: 0,
      latestMigrationAt: null,
      message: 'Schema metadata exists but is not valid JSON.',
    }
  }
}

async function buildHealthCheck(baseDir = dataDir) {
  await mkdir(baseDir, { recursive: true })
  const fileNames = ['settings.json', 'positions.csv', 'performance.csv', 'source.json', 'schema.json']
  const [files, schema, backups, source, priceCache] = await Promise.all([
    Promise.all(fileNames.map((fileName) => statLocalFile(baseDir, fileName))),
    readSchemaHealth(baseDir),
    listLocalBackups(baseDir),
    readPortfolioSourceMetadata(baseDir),
    readPriceCacheHealth(baseDir),
  ])
  const requiredFiles = files.filter((file) =>
    ['settings.json', 'positions.csv', 'performance.csv'].includes(file.fileName),
  )
  const missingRequired = requiredFiles.filter((file) => !file.exists).map((file) => file.fileName)
  const setupRequired = missingRequired.length > 0
  const checks = {
    server: { ok: true, message: 'Local server is running.' },
    dataFiles: {
      ok: !setupRequired,
      missingRequired,
      message: setupRequired
        ? 'Choose demo, blank, or import setup to create missing local files.'
        : 'Required local portfolio files are present.',
    },
    schema: { ok: schema.ok, message: schema.message },
    backups: {
      ok: true,
      message: backups.length
        ? `${backups.length} local backup file${backups.length === 1 ? '' : 's'} found.`
        : 'No backup files found yet. Backups appear after saves, imports, resets, or migrations.',
    },
    priceCache: { ok: priceCache.ok, message: priceCache.message },
  }
  const ok = Object.values(checks).every((check) => check.ok)

  return {
    ok,
    version: appVersion,
    checkedAt: new Date().toISOString(),
    setupRequired,
    checks,
    files,
    schema,
    backups: {
      count: backups.length,
      newestCreatedAt: backups[0]?.createdAt || null,
    },
    source,
    priceCache,
    nextSteps: [
      ...(setupRequired ? ['Open the setup screen and choose demo, blank, or import.'] : []),
      ...(!schema.ok ? ['Restart or refresh the app so local data migrations can run.'] : []),
      ...(!priceCache.ok ? ['Delete data/price-cache.json and refresh live prices.'] : []),
      ...(ok ? ['No action needed.'] : []),
    ],
  }
}

async function resetPortfolioData(payload) {
  const mode = String(payload?.mode || '')

  if (!['demo', 'blank'].includes(mode)) {
    throw validationError('Reset validation failed.', ['Choose demo or blank reset mode.'])
  }

  await ensureLocalDataDirectories()
  await backupLocalDataFiles()
  await rm(logoDir, { recursive: true, force: true })
  await rm(priceCacheFile, { force: true })
  priceCache.clear()
  await mkdir(logoDir, { recursive: true })

  if (mode === 'demo') {
    await seedDemoDataFiles({ overwrite: true })
    return
  }

  await writeBlankDataFiles()
  await writePortfolioSource('user')
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
  return parseCsvDocument(text).rows
}

function parseCsvDocument(text) {
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
  return {
    headers,
    rows: records.map((record) =>
      Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])),
    ),
  }
}

function escapeCsvValue(value) {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(rows) {
  return toCsvWithHeaders(rows, positionCsvHeaders)
}

function toCsvWithHeaders(rows, headers) {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\n')
}

const positionCsvHeaders = [
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

const performanceCsvHeaders = ['date', 'returnPct', 'benchmarkReturnPct']

const requiredSettingsDefaults = {
  accountName: 'Personal Portfolio Book',
  benchmarkName: 'S&P 500',
  benchmarkTicker: 'SPY',
  asOfDate: todayIso,
  periodStart: yearStartIso,
  periodEnd: todayIso,
  accountTotal: 0,
  cashBalance: null,
  baselineInvested: 0,
}

function resolveDefaultValue(value) {
  return typeof value === 'function' ? value() : value
}

async function readSchemaMetadata(baseDir = dataDir) {
  try {
    const raw = await readFile(join(baseDir, 'schema.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      version: Number.isInteger(parsed?.version) ? parsed.version : 0,
      migrations: Array.isArray(parsed?.migrations) ? parsed.migrations : [],
    }
  } catch {
    return { version: 0, migrations: [] }
  }
}

async function writeSchemaMetadata(baseDir, metadata) {
  await writeFile(
    join(baseDir, 'schema.json'),
    `${JSON.stringify(
      {
        version: currentSchemaVersion,
        updatedAt: new Date().toISOString(),
        migrations: metadata.migrations,
      },
      null,
      2,
    )}\n`,
  )
}

function missingColumns(headers, requiredHeaders) {
  const headerSet = new Set(headers)
  return requiredHeaders.filter((header) => !headerSet.has(header))
}

async function migrateCsvColumns(baseDir, fileName, requiredHeaders) {
  const filePath = join(baseDir, fileName)
  if (!(await pathExists(filePath))) return null

  const raw = await readFile(filePath, 'utf8')
  const document = parseCsvDocument(raw)
  const missing = missingColumns(document.headers, requiredHeaders)
  if (missing.length === 0) return null

  await backupLocalDataFileIn(baseDir, fileName)
  const nextHeaders = [...document.headers, ...missing]
  await writeFile(filePath, `${toCsvWithHeaders(document.rows, nextHeaders)}\n`)
  return `Added ${missing.join(', ')} to ${fileName}.`
}

async function migrateSettings(baseDir) {
  const filePath = join(baseDir, 'settings.json')
  if (!(await pathExists(filePath))) return null

  let settings
  try {
    settings = JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    throw validationError('Local data migration failed.', [
      'settings.json is not valid JSON. Restore a file from data/backups or fix the JSON syntax, then restart the app.',
    ])
  }

  const missing = Object.entries(requiredSettingsDefaults).filter(([key]) => settings[key] === undefined)
  if (missing.length === 0) return null

  await backupLocalDataFileIn(baseDir, 'settings.json')
  const nextSettings = {
    ...Object.fromEntries(missing.map(([key, value]) => [key, resolveDefaultValue(value)])),
    ...settings,
  }
  await writeFile(filePath, `${JSON.stringify(nextSettings, null, 2)}\n`)
  return `Added ${missing.map(([key]) => key).join(', ')} to settings.json.`
}

async function migrateLocalDataFiles(baseDir = dataDir) {
  await mkdir(baseDir, { recursive: true })
  const hasPortfolioFiles = await Promise.all(
    ['settings.json', 'positions.csv', 'performance.csv'].map((fileName) => pathExists(join(baseDir, fileName))),
  )
  if (!hasPortfolioFiles.some(Boolean)) return { version: currentSchemaVersion, changes: [] }

  const metadata = await readSchemaMetadata(baseDir)
  const changes = []

  for (const migration of [
    () => migrateSettings(baseDir),
    () => migrateCsvColumns(baseDir, 'positions.csv', positionCsvHeaders),
    () => migrateCsvColumns(baseDir, 'performance.csv', performanceCsvHeaders),
  ]) {
    const change = await migration()
    if (change) changes.push(change)
  }

  if (metadata.version < currentSchemaVersion || changes.length > 0) {
    const migrationRecord = {
      version: currentSchemaVersion,
      appliedAt: new Date().toISOString(),
      changes: changes.length > 0 ? changes : ['Recorded current local data schema version.'],
    }
    await writeSchemaMetadata(baseDir, {
      ...metadata,
      migrations: [...metadata.migrations, migrationRecord],
    })
    if (changes.length > 0) {
      console.log(`Local data migration complete: ${changes.join(' ')}`)
    }
  }

  return { version: currentSchemaVersion, changes }
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

function normalizePriceRecord(record, status = 'cached') {
  const price = toNumber(record?.price)
  if (price <= 0) return null
  return {
    price,
    source: record?.source || 'Last known price',
    fetchedAt: toNumber(record?.fetchedAt, Date.now()),
    status,
  }
}

async function readLastKnownPriceCache(tickers = []) {
  try {
    const raw = await readFile(priceCacheFile, 'utf8')
    const parsed = JSON.parse(raw)
    const requested = new Set(tickers.map(cleanTicker).filter(Boolean))
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([ticker]) => requested.size === 0 || requested.has(cleanTicker(ticker)))
        .map(([ticker, record]) => [cleanTicker(ticker), normalizePriceRecord(record)])
        .filter(([, record]) => record),
    )
  } catch {
    return {}
  }
}

async function writeLastKnownPriceCache(records) {
  const liveRecords = Object.entries(records || {})
    .map(([ticker, record]) => [cleanTicker(ticker), normalizePriceRecord(record, 'live')])
    .filter(([ticker, record]) => ticker && record)

  if (liveRecords.length === 0) return

  await ensureLocalDataDirectories()
  const existing = await readLastKnownPriceCache()
  const next = {
    ...existing,
    ...Object.fromEntries(
      liveRecords.map(([ticker, record]) => [
        ticker,
        {
          price: record.price,
          source: record.source,
          fetchedAt: record.fetchedAt,
        },
      ]),
    ),
  }
  await writeFile(priceCacheFile, `${JSON.stringify(next, null, 2)}\n`)
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

function validationErrorsFrom(action) {
  try {
    action()
    return []
  } catch (error) {
    if (Array.isArray(error?.validationErrors)) return error.validationErrors
    throw error
  }
}

function parseOptionalJsonInput(value, label) {
  if (value === null || value === undefined || value === '') return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      throw validationError('Import preview validation failed.', [`${label} must be valid JSON.`])
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value
  throw validationError('Import preview validation failed.', [`${label} must be a JSON object.`])
}

function previewSettings(input) {
  const settings = parseOptionalJsonInput(input, 'settings')
  return {
    ...normalizeReportingDates(settings),
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    accountTotal: toNumber(settings.accountTotal),
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : 0,
    baselineInvested: toNumber(settings.baselineInvested),
  }
}

function parsePerformancePreview(text) {
  const raw = String(text || '').trim()
  if (!raw) return []

  const rows = parseCsv(raw).map((row) => ({
    date: formatIsoDate(row.date),
    returnPct: row.returnPct ?? '',
    benchmarkReturnPct: row.benchmarkReturnPct ?? '',
  }))
  const errors = []

  rows.forEach((row, index) => {
    const rowNumber = index + 1
    if (!row.date) errors.push(`Performance row ${rowNumber}: date is required.`)
    if (!isValidIsoDate(row.date)) {
      errors.push(`Performance row ${rowNumber}: date must be a YYYY-MM-DD date.`)
    }
    if (row.returnPct !== '' && !hasNumericValue(row.returnPct)) {
      errors.push(`Performance row ${rowNumber}: returnPct must be numeric when filled.`)
    }
    if (row.benchmarkReturnPct !== '' && !hasNumericValue(row.benchmarkReturnPct)) {
      errors.push(`Performance row ${rowNumber}: benchmarkReturnPct must be numeric when filled.`)
    }
  })

  if (errors.length) throw validationError('Performance validation failed.', errors)
  return rows.map((row) => ({
    date: row.date,
    returnPct: toNumber(row.returnPct),
    benchmarkReturnPct: hasNumericValue(row.benchmarkReturnPct) ? toNumber(row.benchmarkReturnPct) : null,
  }))
}

function summarizeImportPositions(positions) {
  const assetTypeCounts = {}
  const missingSectorRows = []
  const missingValueRows = []
  const priceReviewRows = []
  const optionDetailGaps = []
  const tickerReviewRows = []

  positions.forEach((position, index) => {
    const rowNumber = index + 1
    const ticker = cleanTicker(position.ticker)
    const underlying = cleanTicker(position.underlying || position.ticker)
    const assetType = String(position.assetType || 'stock')
    const quantity = hasNumericValue(position.quantity)
    const marketValue = hasNumericValue(position.marketValue)

    assetTypeCounts[assetType] = (assetTypeCounts[assetType] || 0) + 1

    if (!String(position.sector || '').trim()) {
      missingSectorRows.push({ rowNumber, ticker, company: position.company || ticker })
    }
    if (!quantity && !marketValue) {
      missingValueRows.push({ rowNumber, ticker, company: position.company || ticker })
    }
    if (quantity && !marketValue) {
      priceReviewRows.push({
        rowNumber,
        ticker,
        underlying,
        company: position.company || ticker,
        message: 'Relies on live or cached pricing unless you add a fallback marketValue.',
      })
    }

    if (['option', 'spread'].includes(assetType) || position.optionType) {
      const missing = []
      if (!underlying) missing.push('underlying')
      if (!position.optionType) missing.push('optionType')
      if (!hasNumericValue(position.strikePrice)) missing.push('strikePrice')
      if (!position.expiryDate) missing.push('expiryDate')
      if (missing.length) optionDetailGaps.push({ rowNumber, ticker, missing })
    }

    if (!/^[A-Z0-9.-]{1,12}$/.test(underlying)) {
      tickerReviewRows.push({
        rowNumber,
        ticker,
        underlying,
        message: 'Underlying ticker may not price through public quote endpoints.',
      })
    }
    if (logoLookupDisabled(position)) {
      tickerReviewRows.push({
        rowNumber,
        ticker,
        underlying,
        message: 'Logo lookup is intentionally disabled for this row.',
      })
    }
  })

  return {
    rowCount: positions.length,
    assetTypeCounts,
    missingSectorRows,
    missingValueRows,
    priceReviewRows,
    optionDetailGaps,
    tickerReviewRows,
  }
}

function summarizeImportPerformance(rows) {
  const dates = rows.map((row) => row.date).filter(Boolean).sort()
  return {
    rowCount: rows.length,
    hasBenchmarkReturns: rows.some((row) => row.benchmarkReturnPct !== null),
    startDate: dates[0] || '',
    endDate: dates.at(-1) || '',
  }
}

function previewPortfolioImport(payload = {}) {
  const validationErrors = []
  const assumptions = []
  let positions = []
  let rawSettings = {}
  let settings = previewSettings({})
  let performance = []
  const positionsCsv = String(payload.positionsCsv || '')

  try {
    if (!positionsCsv.trim()) validationErrors.push('positionsCsv is required.')
    positions = parseCsv(positionsCsv)
  } catch {
    validationErrors.push('positionsCsv must be valid CSV.')
  }

  validationErrors.push(...validationErrorsFrom(() => validatePositions(positions)))

  try {
    rawSettings = parseOptionalJsonInput(payload.settings ?? payload.settingsJson, 'settings')
    settings = previewSettings(rawSettings)
    validationErrors.push(...validationErrorsFrom(() => validateSettings(settings)))
  } catch (error) {
    if (Array.isArray(error?.validationErrors)) validationErrors.push(...error.validationErrors)
    else throw error
  }

  try {
    performance = parsePerformancePreview(payload.performanceCsv)
  } catch (error) {
    if (Array.isArray(error?.validationErrors)) validationErrors.push(...error.validationErrors)
    else throw error
  }

  if (!hasNumericValue(rawSettings.cashBalance)) {
    assumptions.push('Available cash defaults to $0 unless provided.')
  }
  if (!hasNumericValue(rawSettings.baselineInvested)) {
    assumptions.push('Beginning book value defaults to $0 unless provided.')
  }
  assumptions.push(`Report dates use today's Eastern Time date: ${settings.asOfDate}.`)
  if (!performance.length) {
    assumptions.push('No performance history was provided; the app can use its default YTD baseline.')
  }

  return {
    ok: validationErrors.length === 0,
    validationErrors,
    positions: summarizeImportPositions(positions),
    settings: {
      accountName: settings.accountName,
      benchmarkName: settings.benchmarkName,
      benchmarkTicker: settings.benchmarkTicker,
      asOfDate: settings.asOfDate,
      periodStart: settings.periodStart,
      periodEnd: settings.periodEnd,
      cashBalance: settings.cashBalance,
      baselineInvested: settings.baselineInvested,
    },
    performance: summarizeImportPerformance(performance),
    assumptions,
  }
}

async function writeImportedPortfolioData(payload = {}) {
  const preview = previewPortfolioImport(payload)
  if (!preview.ok) {
    throw validationError('Import validation failed.', preview.validationErrors)
  }

  const positions = parseCsv(String(payload.positionsCsv || ''))
  const rawSettings = parseOptionalJsonInput(payload.settings ?? payload.settingsJson, 'settings')
  const settings = previewSettings(rawSettings)
  const performance = parsePerformancePreview(payload.performanceCsv)

  await ensureLocalDataDirectories()
  await backupLocalDataFiles()
  await writeBlankDataFiles()
  await writeFile(join(dataDir, 'positions.csv'), `${toCsv(positions)}\n`)

  if (Object.keys(rawSettings).length) {
    await writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
  }

  if (performance.length) {
    await writeFile(
      join(dataDir, 'performance.csv'),
      `${toCsvWithHeaders(performance, ['date', 'returnPct', 'benchmarkReturnPct'])}\n`,
    )
  }

  await writePortfolioSource('user')
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
    if (parsed.hostname === 'www.google.com' && parsed.pathname === '/s2/favicons') {
      return parsed.searchParams.get('domain') || ''
    }
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function logoLookupDisabled(position) {
  const logoUrl = String(position?.logoUrl || '')
    .trim()
    .toLowerCase()
  return ['none', 'initials', 'no-logo'].includes(logoUrl)
}

function logoReferenceProvider(value) {
  try {
    const parsed = new URL(value)
    if (parsed.hostname === 'logo.clearbit.com') return 'clearbit'
    if (parsed.hostname === 'www.google.com' && parsed.pathname === '/s2/favicons') return 'google-favicon'
    return 'direct'
  } catch {
    return ''
  }
}

function logoCandidatesForPosition(position) {
  if (logoLookupDisabled(position)) return []

  const candidates = []
  const logoUrl = String(position?.logoUrl || '').trim()
  const domain = extractDomain(logoUrl)
  const provider = logoReferenceProvider(logoUrl)

  if (logoUrl && /^https:\/\//i.test(logoUrl)) {
    candidates.push(logoUrl)
  }

  if (domain && provider !== 'google-favicon') {
    candidates.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
  }

  if (domain && provider === 'clearbit') {
    candidates.push(`https://logo.clearbit.com/${domain}`)
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
  if (logoLookupDisabled(position)) return null

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
  return readSettingsFrom(dataDir)
}

async function readPositions() {
  return readPositionsFrom(dataDir)
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

function normalizePerformanceForReport(points, settings) {
  const periodStart = settings.periodStart || yearStartIso()
  const periodEnd = settings.periodEnd || settings.asOfDate || todayIso()
  const sourcePoints = Array.isArray(points) ? points.filter((point) => point?.date) : []

  if (sourcePoints.length === 0) {
    return [
      { date: periodStart, returnPct: 0, benchmarkReturnPct: null },
      { date: periodEnd, returnPct: 0, benchmarkReturnPct: null },
    ]
  }

  const normalized = sourcePoints.map((point) => ({
    ...point,
    date: formatIsoDate(point.date),
  }))

  if (!normalized.some((point) => point.date === periodStart)) {
    normalized.unshift({ date: periodStart, returnPct: 0, benchmarkReturnPct: null })
  }

  const lastPoint = normalized.at(-1)
  if (lastPoint?.date !== periodEnd) {
    normalized.push({
      date: periodEnd,
      returnPct: lastPoint?.returnPct || 0,
      benchmarkReturnPct: lastPoint?.benchmarkReturnPct ?? null,
    })
  }

  return normalized
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
  if (uniqueTickers.length === 0) return {}

  async function withCachedFallback(livePrices, errorMessage = '') {
    await writeLastKnownPriceCache(livePrices)
    const missing = uniqueTickers.filter((ticker) => !livePrices[ticker])
    const cached = await readLastKnownPriceCache(missing)
    return Object.assign({ ...livePrices, ...cached }, errorMessage ? { _error: errorMessage } : {})
  }

  try {
    const yahoo = await fetchYahooChartPrices(uniqueTickers)
    const missing = uniqueTickers.filter((ticker) => !yahoo[ticker])
    if (missing.length === 0) return withCachedFallback(yahoo)
    const stooq = await fetchStooqPrices(missing)
    return withCachedFallback({ ...yahoo, ...stooq })
  } catch (error) {
    const stooq = await fetchStooqPrices(uniqueTickers)
    return withCachedFallback(stooq, error instanceof Error ? error.message : 'Price fetch failed.')
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
      item.priceStatus = priceRecord?.status === 'cached' ? 'cached' : 'live'
    } else if (hasFallbackMarketValue && !['live', 'cached'].includes(item.priceStatus)) {
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
  const schema = await migrateLocalDataFiles()
  const [settings, positions] = await Promise.all([readSettings(), readPositions()])
  const source = await readPortfolioSource(settings)
  const tickers = positions.map((position) => position.underlying || position.ticker)
  const prices = await fetchPrices(tickers)
  const basePerformance = await readPerformance(settings)
  const consolidated = consolidatePositions(positions, prices, settings)
  const performance = normalizePerformanceForReport(basePerformance, settings).map((point, index, points) =>
    index === points.length - 1 ? { ...point, returnPct: consolidated.metrics.ytdReturnPercent } : point,
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
    source,
    schema,
    yearStartReview: yearStartReviewForSettings(settings),
    ...consolidated,
  }
}

function normalizeSettingsForRead(settings) {
  const reportingDates = normalizeReportingDates(settings)
  return {
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    asOfDate: reportingDates.asOfDate,
    periodStart: reportingDates.periodStart,
    periodEnd: reportingDates.periodEnd,
    accountTotal: toNumber(settings.accountTotal),
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : null,
    baselineInvested: toNumber(settings.baselineInvested),
  }
}

function normalizePositionForRead(row, index) {
  return {
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
  }
}

async function readSettingsFrom(baseDir = dataDir) {
  const raw = await readFile(join(baseDir, 'settings.json'), 'utf8')
  return normalizeSettingsForRead(JSON.parse(raw))
}

async function readPositionsFrom(baseDir = dataDir) {
  const raw = await readFile(join(baseDir, 'positions.csv'), 'utf8')
  return parseCsv(raw).map(normalizePositionForRead)
}

async function resetYearStartBaseline(baseDir = dataDir, priceLookup = fetchPrices) {
  await mkdir(baseDir, { recursive: true })
  await migrateLocalDataFiles(baseDir)
  const [settings, positions] = await Promise.all([readSettingsFrom(baseDir), readPositionsFrom(baseDir)])
  const tickers = positions.map((position) => position.underlying || position.ticker)
  const prices = await priceLookup(tickers)
  const consolidated = consolidatePositions(positions, prices, settings)
  const today = todayIso()
  const periodStart = yearStartIso(today)
  const nextSettings = {
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    asOfDate: today,
    periodStart,
    periodEnd: today,
    accountTotal: consolidated.metrics.accountTotal,
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : null,
    baselineInvested: consolidated.metrics.accountTotal,
  }

  validateSettings(nextSettings)
  await Promise.all([
    backupLocalDataFileIn(baseDir, 'settings.json'),
    backupLocalDataFileIn(baseDir, 'performance.csv'),
  ])
  await Promise.all([
    writeFile(join(baseDir, 'settings.json'), `${JSON.stringify(nextSettings, null, 2)}\n`),
    writeFile(
      join(baseDir, 'performance.csv'),
      `date,returnPct,benchmarkReturnPct\n${periodStart},0,\n${today},0,\n`,
    ),
    writeFile(join(baseDir, 'source.json'), `${JSON.stringify({ source: 'user', updatedAt: new Date().toISOString() }, null, 2)}\n`),
  ])
}

async function saveSettings(payload) {
  await ensureLocalDataDirectories()
  await migrateLocalDataFiles()
  validateSettings(payload)
  await backupLocalDataFile('settings.json')
  const next = {
    ...normalizeReportingDates(payload),
    accountName: payload.accountName || 'Personal Portfolio Book',
    benchmarkName: payload.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(payload.benchmarkTicker),
    accountTotal: toNumber(payload.accountTotal),
    cashBalance: hasNumericValue(payload.cashBalance) ? toNumber(payload.cashBalance) : null,
    baselineInvested: toNumber(payload.baselineInvested),
  }
  await writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(next, null, 2)}\n`)
  await writePortfolioSource('user')
}

async function savePositions(positions) {
  await ensureLocalDataDirectories()
  await migrateLocalDataFiles()
  validatePositions(positions)
  await backupLocalDataFile('positions.csv')
  const rows = Array.isArray(positions) ? positions.map(normalizePositionForSave) : []
  await writeFile(join(dataDir, 'positions.csv'), `${toCsv(rows)}\n`)
  await writePortfolioSource('user')
}

async function savePortfolio(payload) {
  await ensureLocalDataDirectories()
  await migrateLocalDataFiles()
  const settings = payload?.settings || {}
  const positions = payload?.positions
  validateSettings(settings)
  validatePositions(positions)
  await backupLocalDataFile('settings.json')
  await backupLocalDataFile('positions.csv')
  const nextSettings = {
    ...normalizeReportingDates(settings),
    accountName: settings.accountName || 'Personal Portfolio Book',
    benchmarkName: settings.benchmarkName || 'S&P 500',
    benchmarkTicker: cleanBenchmarkTicker(settings.benchmarkTicker),
    accountTotal: toNumber(settings.accountTotal),
    cashBalance: hasNumericValue(settings.cashBalance) ? toNumber(settings.cashBalance) : null,
    baselineInvested: toNumber(settings.baselineInvested),
  }
  await Promise.all([
    writeFile(join(dataDir, 'settings.json'), `${JSON.stringify(nextSettings, null, 2)}\n`),
    writeFile(join(dataDir, 'positions.csv'), `${toCsv(positions.map(normalizePositionForSave))}\n`),
    writePortfolioSource('user'),
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

    if (url.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, await buildHealthCheck())
      return
    }

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

    if (url.pathname === '/api/import/preview' && request.method === 'POST') {
      const body = await readBody(request)
      sendJson(response, 200, previewPortfolioImport(body))
      return
    }

    if (url.pathname === '/api/import/commit' && request.method === 'POST') {
      const body = await readBody(request)
      await writeImportedPortfolioData(body)
      sendJson(response, 200, await buildPortfolio())
      return
    }

    if (url.pathname === '/api/backups' && request.method === 'GET') {
      sendJson(response, 200, { backups: await listLocalBackups() })
      return
    }

    if (url.pathname === '/api/backups/restore' && request.method === 'POST') {
      const body = await readBody(request)
      const restore = await restoreLocalBackup(body)
      sendJson(response, 200, { restore, portfolio: await buildPortfolio() })
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

    if (url.pathname === '/api/year-start/reset' && request.method === 'POST') {
      await resetYearStartBaseline()
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
      await migrateLocalDataFiles()
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
      await migrateLocalDataFiles()
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

export {
  buildHealthCheck,
  cleanBenchmarkTicker,
  consolidatePositions,
  inferStructure,
  isoDateInTimeZone,
  listLocalBackups,
  logoCandidatesForPosition,
  migrateLocalDataFiles,
  normalizePerformanceForReport,
  normalizeReportingDates,
  previewPortfolioImport,
  resetYearStartBaseline,
  restoreLocalBackup,
  validatePositions,
  validateSettings,
  yearStartReviewForSettings,
}

if (isMainModule) {
  await ensureLocalDataDirectories()
  if (await hasLocalPortfolioData()) await migrateLocalDataFiles()

  server.listen(port, '127.0.0.1', () => {
    console.log(`Portfolio Review is running at http://127.0.0.1:${port}`)
  })
}
