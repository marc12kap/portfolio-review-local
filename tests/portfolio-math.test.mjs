import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
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
} from '../server.mjs'

const settings = (overrides = {}) => ({
  accountTotal: 10_000,
  baselineInvested: 8_000,
  ...overrides,
})

const position = (overrides = {}) => ({
  ticker: 'ABC',
  company: 'ABC Corp',
  underlying: 'ABC',
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
  sector: 'Technology',
  structure: '',
  logoUrl: '',
  ...overrides,
})

const prices = {
  ABC: { price: 20, source: 'test', fetchedAt: 1 },
  XYZ: { price: 10, source: 'test', fetchedAt: 1 },
}

function byTicker(result, ticker) {
  return result.holdings.find((holding) => holding.ticker === ticker)
}

describe('consolidatePositions', () => {
  it('uses fallback market values and calculates cash, weights, and YTD return', () => {
    const result = consolidatePositions(
      [position({ quantity: '', marketValue: '6000' })],
      {},
      settings(),
    )

    assert.equal(result.metrics.investedValue, 6_000)
    assert.equal(result.metrics.cashValue, 4_000)
    assert.equal(result.metrics.cashWeight, 40)
    assert.equal(result.metrics.netInvestedPercent, 60)
    assert.equal(result.metrics.topFiveConcentration, 60)
    assert.equal(result.metrics.topHoldingWeight, 60)
    assert.equal(result.metrics.ytdReturnPercent, 25)

    assert.equal(byTicker(result, 'ABC').weight, 60)
    assert.equal(byTicker(result, 'ABC').priceStatus, 'fallback')
    assert.equal(byTicker(result, 'ABC').priceFetchedAt, null)
    assert.deepEqual(result.sectors, [
      { name: 'Technology', weight: 60 },
      { name: 'Cash & Equivalents', weight: 40 },
    ])
  })

  it('uses live prices when quantity is available', () => {
    const result = consolidatePositions(
      [position({ quantity: '10', marketValue: '9999' })],
      prices,
      settings({ accountTotal: 1_000, baselineInvested: 1_000 }),
    )

    assert.equal(result.metrics.investedValue, 200)
    assert.equal(result.metrics.cashValue, 800)
    assert.equal(result.metrics.topFiveConcentration, 20)
    assert.equal(byTicker(result, 'ABC').value, 200)
    assert.equal(byTicker(result, 'ABC').price, 20)
    assert.equal(byTicker(result, 'ABC').priceSource, 'test')
    assert.equal(byTicker(result, 'ABC').priceFetchedAt, 1)
    assert.equal(byTicker(result, 'ABC').priceStatus, 'live')
  })

  it('uses cached last-known prices before manual fallback values', () => {
    const result = consolidatePositions(
      [position({ quantity: '10', marketValue: '9999' })],
      {
        ABC: {
          price: 21,
          source: 'Yahoo Finance chart',
          fetchedAt: 123,
          status: 'cached',
        },
      },
      settings({ accountTotal: 1_000, baselineInvested: 1_000 }),
    )

    assert.equal(result.priceIssues.length, 0)
    assert.equal(result.metrics.investedValue, 210)
    assert.equal(byTicker(result, 'ABC').value, 210)
    assert.equal(byTicker(result, 'ABC').price, 21)
    assert.equal(byTicker(result, 'ABC').priceSource, 'Yahoo Finance chart')
    assert.equal(byTicker(result, 'ABC').priceFetchedAt, 123)
    assert.equal(byTicker(result, 'ABC').priceStatus, 'cached')
  })

  it('calculates current book value from invested value plus cash balance', () => {
    const result = consolidatePositions(
      [position({ quantity: '10' })],
      prices,
      settings({ accountTotal: 10_000, cashBalance: 300, baselineInvested: 400 }),
    )

    assert.equal(result.metrics.investedValue, 200)
    assert.equal(result.metrics.cashValue, 300)
    assert.equal(result.metrics.accountTotal, 500)
    assert.equal(result.metrics.cashWeight, 60)
    assert.equal(result.metrics.ytdReturnPercent, 25)
    assert.equal(byTicker(result, 'ABC').weight, 40)
  })

  it('preserves legacy account total behavior when cash balance is missing', () => {
    const result = consolidatePositions(
      [position({ quantity: '10' })],
      prices,
      settings({ accountTotal: 1_000, baselineInvested: 1_000 }),
    )

    assert.equal(result.metrics.investedValue, 200)
    assert.equal(result.metrics.cashValue, 800)
    assert.equal(result.metrics.accountTotal, 1_000)
    assert.equal(byTicker(result, 'ABC').weight, 20)
  })

  it('surfaces quantity rows with no live price and no fallback market value', () => {
    const result = consolidatePositions(
      [
        position({
          ticker: 'NOPE',
          company: 'Bad Ticker Corp',
          underlying: 'NOPE',
          quantity: '12',
        }),
      ],
      {},
      settings({ accountTotal: 10_000, baselineInvested: 10_000 }),
    )

    assert.equal(result.holdings.length, 0)
    assert.deepEqual(result.priceIssues, [
      {
        rowNumber: 1,
        ticker: 'NOPE',
        underlying: 'NOPE',
        company: 'Bad Ticker Corp',
        quantity: 12,
        assetType: 'stock',
        message: 'No live price was found and no fallback market value is set.',
      },
    ])
  })

  it('does not report a price issue when fallback market value is available', () => {
    const result = consolidatePositions(
      [position({ ticker: 'NOPE', underlying: 'NOPE', quantity: '12', marketValue: '1200' })],
      {},
      settings({ accountTotal: 10_000, baselineInvested: 10_000 }),
    )

    assert.equal(result.priceIssues.length, 0)
    assert.equal(byTicker(result, 'NOPE').priceStatus, 'fallback')
  })

  it('applies default option multipliers for long call exposure', () => {
    const result = consolidatePositions(
      [
        position({
          assetType: 'option',
          optionType: 'call',
          quantity: '2',
          marketValue: '',
          structure: 'Long call position',
        }),
      ],
      prices,
      settings({ accountTotal: 5_000, baselineInvested: 5_000 }),
    )

    const holding = byTicker(result, 'ABC')
    assert.equal(holding.value, 4_000)
    assert.equal(holding.weight, 80)
    assert.equal(holding.structure, 'Long call position')
  })

  it('nets short option rows against stock exposure', () => {
    const result = consolidatePositions(
      [
        position({ assetType: 'stock', quantity: '100' }),
        position({
          assetType: 'option',
          optionType: 'call',
          side: 'short',
          quantity: '0.25',
        }),
      ],
      prices,
      settings({ accountTotal: 2_000, baselineInvested: 2_000 }),
    )

    const holding = byTicker(result, 'ABC')
    assert.equal(holding.value, 1_500)
    assert.equal(holding.weight, 75)
    assert.equal(holding.structure, 'Common shares with covered calls')
  })

  it('consolidates spread rows into the underlying ticker', () => {
    const result = consolidatePositions(
      [
        position({
          assetType: 'spread',
          optionType: 'call',
          quantity: '2',
        }),
        position({
          assetType: 'spread',
          optionType: 'call',
          side: 'short',
          quantity: '1',
        }),
      ],
      prices,
      settings({ accountTotal: 3_000, baselineInvested: 3_000 }),
    )

    const holding = byTicker(result, 'ABC')
    assert.equal(holding.value, 2_000)
    assert.equal(holding.weight, 66.66666666666666)
    assert.equal(holding.structure, 'Long call spread')
    assert.deepEqual(result.optionExposures, [
      {
        ticker: 'ABC',
        value: 2_000,
        weight: 66.66666666666666,
        legCount: 2,
        callCount: 2,
        putCount: 0,
        spreadCount: 2,
        netContracts: 1,
        expirations: [],
      },
    ])
  })

  it('summarizes option exposure by underlying with expirations and short legs', () => {
    const result = consolidatePositions(
      [
        position({ assetType: 'stock', quantity: '100' }),
        position({
          assetType: 'option',
          optionType: 'call',
          quantity: '1',
          expiryDate: '2026-12-18',
        }),
        position({
          assetType: 'option',
          optionType: 'put',
          side: 'short',
          quantity: '0.5',
          expiryDate: '2026-09-18',
        }),
      ],
      prices,
      settings({ accountTotal: 5_000, baselineInvested: 5_000 }),
    )

    assert.deepEqual(result.optionExposures, [
      {
        ticker: 'ABC',
        value: 1_000,
        weight: 20,
        legCount: 2,
        callCount: 1,
        putCount: 1,
        spreadCount: 0,
        netContracts: 0.5,
        expirations: ['2026-09-18', '2026-12-18'],
      },
    ])
  })

  it('falls back to invested value as account total when settings account total is missing', () => {
    const result = consolidatePositions(
      [
        position({ ticker: 'ABC', underlying: 'ABC', quantity: '10' }),
        position({ ticker: 'XYZ', underlying: 'XYZ', quantity: '10', sector: 'Industrials' }),
      ],
      prices,
      settings({ accountTotal: 0, baselineInvested: 0 }),
    )

    assert.equal(result.metrics.accountTotal, 300)
    assert.equal(result.metrics.baselineInvested, 300)
    assert.equal(result.metrics.cashValue, 0)
    assert.equal(result.metrics.underlyingCount, 2)
  })

  it('calculates top five concentration from sorted holding weights', () => {
    const result = consolidatePositions(
      [
        position({ ticker: 'AAA', underlying: 'AAA', marketValue: '3000' }),
        position({ ticker: 'BBB', underlying: 'BBB', marketValue: '2500', sector: 'Industrials' }),
        position({ ticker: 'CCC', underlying: 'CCC', marketValue: '1500', sector: 'Energy' }),
        position({ ticker: 'DDD', underlying: 'DDD', marketValue: '1000', sector: 'Health Care' }),
        position({ ticker: 'EEE', underlying: 'EEE', marketValue: '750', sector: 'Financials' }),
        position({ ticker: 'FFF', underlying: 'FFF', marketValue: '500', sector: 'Consumer' }),
      ],
      {},
      settings({ accountTotal: 10_000, baselineInvested: 10_000 }),
    )

    assert.deepEqual(
      result.holdings.slice(0, 5).map((holding) => holding.ticker),
      ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'],
    )
    assert.equal(result.metrics.topFiveConcentration, 87.5)
    assert.equal(result.metrics.topHoldingWeight, 30)
  })
})

describe('inferStructure', () => {
  it('describes common option overlays', () => {
    assert.equal(
      inferStructure([
        position({ assetType: 'stock' }),
        position({ assetType: 'option', optionType: 'put' }),
      ]),
      'Common shares with option overlay',
    )
  })
})

describe('validation', () => {
  it('accepts valid positions and settings', () => {
    assert.doesNotThrow(() =>
      validatePositions([
        position({ ticker: 'ABC', quantity: '10', marketValue: '', expiryDate: '' }),
        position({
          ticker: 'ABC 250117C00020000',
          underlying: 'ABC',
          assetType: 'option',
          optionType: 'call',
          quantity: '1',
          multiplier: '100',
          expiryDate: '2027-01-15',
        }),
      ]),
    )
    assert.doesNotThrow(() =>
      validateSettings({
        accountTotal: 10_000,
        cashBalance: 2_000,
        baselineInvested: 8_000,
        asOfDate: '2026-06-18',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-18',
      }),
    )
  })

  it('rejects row-level position errors without normalizing them away', () => {
    assert.throws(
      () =>
        validatePositions([
          position({
            ticker: '',
            assetType: 'crypto',
            side: 'borrowed',
            quantity: 'ten',
            marketValue: '',
            optionType: 'maybe',
            expiryDate: 'next week',
          }),
        ]),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.deepEqual(error.validationErrors, [
          'Row 1: ticker is required.',
          'Row 1: asset type must be stock, option, spread, or cash.',
          'Row 1: side must be long or short.',
          'Row 1: option type must be call or put.',
          'Row 1: quantity must be numeric when filled.',
          'Row 1: enter quantity or fallback market value.',
          'Row 1: expiry date must be a YYYY-MM-DD date.',
        ])
        return true
      },
    )
  })

  it('rejects invalid settings values', () => {
    assert.throws(
      () =>
        validateSettings({
          accountTotal: 'many',
          cashBalance: 'some',
          baselineInvested: '',
          asOfDate: 'June 18',
          periodStart: '2026-01-01',
          periodEnd: '2026-06-18',
        }),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.deepEqual(error.validationErrors, [
          'Current book value must be a number.',
          'Available cash must be a number.',
          'Beginning book value must be a number.',
          'As-of date must be a YYYY-MM-DD date.',
        ])
        return true
      },
    )
  })
})

describe('benchmark settings', () => {
  it('defaults blank benchmark tickers to SPY and normalizes custom tickers', () => {
    assert.equal(cleanBenchmarkTicker(''), 'SPY')
    assert.equal(cleanBenchmarkTicker(undefined), 'SPY')
    assert.equal(cleanBenchmarkTicker(' voo '), 'VOO')
  })
})

describe('reporting date defaults', () => {
  it('uses the Eastern Time calendar date instead of UTC for late-night reports', () => {
    const utcRolloverBeforeEasternMidnight = new Date('2026-07-04T03:30:00.000Z')
    assert.equal(isoDateInTimeZone(utcRolloverBeforeEasternMidnight), '2026-07-03')
  })

  it('uses today for current report dates even when saved dates are stale', () => {
    assert.deepEqual(
      normalizeReportingDates(
        {
          asOfDate: '2026-01-15',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-15',
        },
        '2026-06-19',
      ),
      {
        asOfDate: '2026-06-19',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-19',
      },
    )
  })

  it('falls back to the current year start when period start is missing or future dated', () => {
    assert.deepEqual(
      normalizeReportingDates({ periodStart: '2027-01-01' }, '2026-06-19'),
      {
        asOfDate: '2026-06-19',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-19',
      },
    )
  })

  it('preserves user-supplied performance history and appends today for the current report', () => {
    assert.deepEqual(
      normalizePerformanceForReport(
        [
          { date: '2026-01-01', returnPct: 0, benchmarkReturnPct: 0 },
          { date: '2026-03-31', returnPct: 2.5, benchmarkReturnPct: 1.2 },
        ],
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-06-19',
          asOfDate: '2026-06-19',
        },
      ),
      [
        { date: '2026-01-01', returnPct: 0, benchmarkReturnPct: 0 },
        { date: '2026-03-31', returnPct: 2.5, benchmarkReturnPct: 1.2 },
        { date: '2026-06-19', returnPct: 2.5, benchmarkReturnPct: 1.2 },
      ],
    )
  })
})

describe('logo sourcing', () => {
  it('uses explicit logo sources and same-company favicon fallback for Clearbit references', () => {
    assert.deepEqual(
      logoCandidatesForPosition({ logoUrl: 'https://logo.clearbit.com/apple.com' }),
      [
        'https://logo.clearbit.com/apple.com',
        'https://www.google.com/s2/favicons?domain=apple.com&sz=128',
      ],
    )
  })

  it('does not turn explicit Google favicon sources into Google or Clearbit candidates', () => {
    assert.deepEqual(
      logoCandidatesForPosition({
        logoUrl: 'https://www.google.com/s2/favicons?domain=spacex.com&sz=128',
      }),
      ['https://www.google.com/s2/favicons?domain=spacex.com&sz=128'],
    )
  })

  it('allows private or low-confidence rows to use clean initials fallback', () => {
    assert.deepEqual(logoCandidatesForPosition({ logoUrl: 'initials' }), [])
    assert.deepEqual(logoCandidatesForPosition({ logoUrl: 'none' }), [])
  })
})

describe('import preview', () => {
  it('summarizes valid proposed files without writing local data', async () => {
    const dir = await tempDataDir()
    await writeFile(join(dir, 'sentinel.txt'), 'keep')
    const before = await readdir(dir)

    const result = previewPortfolioImport({
      positionsCsv: [
        'ticker,company,underlying,assetType,side,quantity,averageCost,marketValue,sector,optionType,strikePrice,expiryDate',
        'AAPL,Apple Inc.,AAPL,stock,long,10,180,,Mega-Cap Technology,,,',
        'AAPL 260619C00240000,Apple Covered Call,AAPL,option,short,1,15,-4500,Mega-Cap Technology,call,240,2026-06-19',
      ].join('\n'),
      settings: {
        accountName: 'Preview Portfolio',
        cashBalance: 5000,
        baselineInvested: 100000,
        benchmarkTicker: 'VOO',
      },
      performanceCsv: 'date,returnPct,benchmarkReturnPct\n2026-01-01,0,0\n2026-03-31,2.5,1.9\n',
    })
    const after = await readdir(dir)

    assert.equal(result.ok, true)
    assert.deepEqual(after, before)
    assert.deepEqual(result.positions.assetTypeCounts, { stock: 1, option: 1 })
    assert.equal(result.positions.priceReviewRows.length, 1)
    assert.equal(result.positions.optionDetailGaps.length, 0)
    assert.equal(result.settings.benchmarkTicker, 'VOO')
    assert.equal(result.performance.rowCount, 2)
    assert.equal(result.performance.hasBenchmarkReturns, true)
  })

  it('returns row-level validation errors and review metadata for bad proposed rows', () => {
    const result = previewPortfolioImport({
      positionsCsv: 'ticker,company,assetType,side,quantity,marketValue,sector\n,Missing Ticker,crypto,borrowed,ten,,',
      settingsJson: '{bad json',
      performanceCsv: 'date,returnPct\nnot-a-date,many\n',
    })

    assert.equal(result.ok, false)
    assert.deepEqual(result.validationErrors, [
      'Row 1: ticker is required.',
      'Row 1: underlying ticker is required.',
      'Row 1: asset type must be stock, option, spread, or cash.',
      'Row 1: side must be long or short.',
      'Row 1: quantity must be numeric when filled.',
      'Row 1: enter quantity or fallback market value.',
      'settings must be valid JSON.',
      'Performance row 1: date must be a YYYY-MM-DD date.',
      'Performance row 1: returnPct must be numeric when filled.',
    ])
    assert.equal(result.positions.missingSectorRows.length, 1)
    assert.equal(result.positions.missingValueRows.length, 1)
  })
})

async function tempDataDir() {
  return mkdtemp(join(tmpdir(), 'portfolio-review-migration-'))
}

async function pathExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

describe('local data migrations', () => {
  it('adds missing positions CSV columns without dropping user columns', async () => {
    const dir = await tempDataDir()
    await writeFile(
      join(dir, 'positions.csv'),
      'ticker,company,quantity,customNote\nAAPL,Apple,10,keep me\n',
    )
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        accountName: 'Old Book',
        asOfDate: '2026-06-18',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-18',
        accountTotal: 1000,
        baselineInvested: 900,
      }),
    )
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct\n2026-01-01,0\n')

    const result = await migrateLocalDataFiles(dir)
    const migratedPositions = await readFile(join(dir, 'positions.csv'), 'utf8')

    assert.equal(result.version, 1)
    assert.match(migratedPositions.split('\n')[0], /customNote/)
    assert.match(migratedPositions.split('\n')[0], /logoUrl/)
    assert.match(migratedPositions, /keep me/)
    assert.equal(await pathExists(join(dir, 'backups')), true)
  })

  it('adds missing settings fields and records schema metadata', async () => {
    const dir = await tempDataDir()
    await writeFile(join(dir, 'positions.csv'), 'ticker,quantity\nIBM,3\n')
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct\n2026-01-01,0\n')
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        accountName: 'Legacy Portfolio',
        asOfDate: '2026-06-18',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-18',
        accountTotal: 1000,
        baselineInvested: 800,
      }),
    )

    await migrateLocalDataFiles(dir)
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    const schema = JSON.parse(await readFile(join(dir, 'schema.json'), 'utf8'))

    assert.equal(settings.benchmarkName, 'S&P 500')
    assert.equal(settings.benchmarkTicker, 'SPY')
    assert.equal(settings.cashBalance, null)
    assert.equal(schema.version, 1)
    assert.equal(schema.migrations.length, 1)
  })

  it('fails invalid settings migrations without writing schema metadata', async () => {
    const dir = await tempDataDir()
    await writeFile(join(dir, 'positions.csv'), 'ticker,quantity\nIBM,3\n')
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct\n2026-01-01,0\n')
    await writeFile(join(dir, 'settings.json'), '{not valid json')

    await assert.rejects(
      () => migrateLocalDataFiles(dir),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.deepEqual(error.validationErrors, [
          'settings.json is not valid JSON. Restore a file from data/backups or fix the JSON syntax, then restart the app.',
        ])
        return true
      },
    )

    assert.equal(await pathExists(join(dir, 'schema.json')), false)
  })
})

describe('local backup restore', () => {
  it('lists restorable backup files with metadata', async () => {
    const dir = await tempDataDir()
    await mkdir(join(dir, 'backups'), { recursive: true })
    await writeFile(join(dir, 'backups', 'settings-2026-06-19T13-02-01-123Z.json'), '{}')
    await writeFile(join(dir, 'backups', 'positions-2026-06-19T13-03-01-123Z.csv'), 'ticker,quantity\nAAPL,1\n')
    await writeFile(join(dir, 'backups', 'notes-2026-06-19T13-03-01-123Z.txt'), 'ignore me')

    const backups = await listLocalBackups(dir)

    assert.deepEqual(
      backups.map(({ fileName, fileType, targetFileName, label, createdAt }) => ({
        fileName,
        fileType,
        targetFileName,
        label,
        createdAt,
      })),
      [
        {
          fileName: 'positions-2026-06-19T13-03-01-123Z.csv',
          fileType: 'positions',
          targetFileName: 'positions.csv',
          label: 'Positions',
          createdAt: '2026-06-19T13:03:01.123Z',
        },
        {
          fileName: 'settings-2026-06-19T13-02-01-123Z.json',
          fileType: 'settings',
          targetFileName: 'settings.json',
          label: 'Settings',
          createdAt: '2026-06-19T13:02:01.123Z',
        },
      ],
    )
  })

  it('validates and restores one backup file after backing up the current file', async () => {
    const dir = await tempDataDir()
    await mkdir(join(dir, 'backups'), { recursive: true })
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        accountName: 'Current Book',
        asOfDate: '2026-06-19',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-19',
        accountTotal: 1000,
        cashBalance: 100,
        baselineInvested: 900,
      }),
    )
    await writeFile(join(dir, 'positions.csv'), 'ticker,quantity\nAAPL,1\n')
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct\n2026-01-01,0\n')
    await writeFile(
      join(dir, 'backups', 'settings-2026-06-19T13-02-01-123Z.json'),
      JSON.stringify({
        accountName: 'Restored Book',
        asOfDate: '2026-06-19',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-19',
        accountTotal: 2000,
        cashBalance: 200,
        baselineInvested: 1800,
      }),
    )

    const result = await restoreLocalBackup(
      { fileName: 'settings-2026-06-19T13-02-01-123Z.json' },
      dir,
    )
    const restoredSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    const backupFiles = await readdir(join(dir, 'backups'))

    assert.equal(result.restored.targetFileName, 'settings.json')
    assert.match(result.currentBackupFileName, /^settings-\d{4}-\d{2}-\d{2}T/)
    assert.equal(restoredSettings.accountName, 'Restored Book')
    assert.equal(backupFiles.some((fileName) => fileName === result.currentBackupFileName), true)
  })

  it('rejects invalid backup content without replacing the current file', async () => {
    const dir = await tempDataDir()
    await mkdir(join(dir, 'backups'), { recursive: true })
    await writeFile(join(dir, 'positions.csv'), 'ticker,quantity\nAAPL,1\n')
    await writeFile(
      join(dir, 'backups', 'positions-2026-06-19T13-02-01-123Z.csv'),
      'ticker,quantity\n,not-a-number\n',
    )

    await assert.rejects(
      () => restoreLocalBackup({ fileName: 'positions-2026-06-19T13-02-01-123Z.csv' }, dir),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.equal(error.message, 'Positions validation failed.')
        assert.deepEqual(error.validationErrors, [
          'Row 1: ticker is required.',
          'Row 1: underlying ticker is required.',
          'Row 1: quantity must be numeric when filled.',
          'Row 1: enter quantity or fallback market value.',
        ])
        return true
      },
    )

    assert.equal(await readFile(join(dir, 'positions.csv'), 'utf8'), 'ticker,quantity\nAAPL,1\n')
  })
})

describe('local health check', () => {
  it('reports setup-required state without exposing portfolio rows', async () => {
    const dir = await tempDataDir()

    const result = await buildHealthCheck(dir)

    assert.equal(result.ok, false)
    assert.equal(result.setupRequired, true)
    assert.deepEqual(result.checks.dataFiles.missingRequired, [
      'settings.json',
      'positions.csv',
      'performance.csv',
    ])
    assert.equal(result.backups.count, 0)
    assert.equal(result.source.source, 'missing')
    assert.equal(result.priceCache.recordCount, 0)
    assert.equal('positions' in result, false)
    assert.equal('holdings' in result, false)
  })

  it('summarizes local files, schema, backups, source, and price cache', async () => {
    const dir = await tempDataDir()
    await mkdir(join(dir, 'backups'), { recursive: true })
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        accountName: 'Private Book',
        benchmarkName: 'S&P 500',
        benchmarkTicker: 'SPY',
        asOfDate: '2026-06-19',
        periodStart: '2026-01-01',
        periodEnd: '2026-06-19',
        accountTotal: 1000,
        cashBalance: 100,
        baselineInvested: 900,
      }),
    )
    await writeFile(join(dir, 'positions.csv'), 'ticker,quantity\nAAPL,1\n')
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct,benchmarkReturnPct\n2026-01-01,0,\n')
    await writeFile(join(dir, 'source.json'), JSON.stringify({ source: 'user', updatedAt: '2026-06-19T13:00:00.000Z' }))
    await writeFile(
      join(dir, 'schema.json'),
      JSON.stringify({
        version: 1,
        migrations: [{ version: 1, appliedAt: '2026-06-19T13:00:00.000Z', changes: [] }],
      }),
    )
    await writeFile(
      join(dir, 'price-cache.json'),
      JSON.stringify({ AAPL: { price: 200, source: 'test', fetchedAt: 1781874000000 } }),
    )
    await writeFile(join(dir, 'backups', 'settings-2026-06-19T13-02-01-123Z.json'), '{}')

    const result = await buildHealthCheck(dir)

    assert.equal(result.ok, true)
    assert.equal(result.setupRequired, false)
    assert.equal(result.version, '1.0.1')
    assert.equal(result.checks.server.ok, true)
    assert.equal(result.checks.dataFiles.ok, true)
    assert.equal(result.schema.version, 1)
    assert.equal(result.schema.migrationCount, 1)
    assert.equal(result.backups.count, 1)
    assert.equal(result.source.source, 'user')
    assert.equal(result.priceCache.recordCount, 1)
    assert.deepEqual(result.nextSteps, ['No action needed.'])
  })
})

describe('year-start review', () => {
  it('detects stale period starts from a previous calendar year', () => {
    assert.deepEqual(
      yearStartReviewForSettings({ periodStart: '2025-01-01' }, '2026-06-19'),
      {
        required: true,
        currentYear: '2026',
        currentYearStart: '2026-01-01',
        periodStart: '2025-01-01',
        periodStartYear: '2025',
      },
    )

    assert.equal(
      yearStartReviewForSettings({ periodStart: '2026-01-01' }, '2026-06-19').required,
      false,
    )
  })

  it('backs up settings and performance before resetting current-year baseline', async () => {
    const dir = await tempDataDir()
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        accountName: 'Year Start Book',
        benchmarkName: 'S&P 500',
        benchmarkTicker: 'SPY',
        asOfDate: '2025-12-31',
        periodStart: '2025-01-01',
        periodEnd: '2025-12-31',
        accountTotal: 0,
        cashBalance: 250,
        baselineInvested: 900,
      }),
    )
    await writeFile(
      join(dir, 'positions.csv'),
      'ticker,company,underlying,assetType,side,quantity,marketValue,sector\nAAPL,Apple,AAPL,stock,long,,750,Technology\n',
    )
    await writeFile(join(dir, 'performance.csv'), 'date,returnPct,benchmarkReturnPct\n2025-01-01,0,0\n')
    await writeFile(
      join(dir, 'schema.json'),
      JSON.stringify({
        version: 1,
        migrations: [{ version: 1, appliedAt: '2026-06-19T13:00:00.000Z', changes: [] }],
      }),
    )

    await resetYearStartBaseline(dir, async () => ({}))
    const nextSettings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    const nextPerformance = await readFile(join(dir, 'performance.csv'), 'utf8')
    const backupFiles = await readdir(join(dir, 'backups'))
    const currentYear = new Date().getFullYear()

    assert.equal(nextSettings.periodStart, `${currentYear}-01-01`)
    assert.equal(nextSettings.baselineInvested, 1000)
    assert.equal(nextSettings.cashBalance, 250)
    assert.match(
      nextPerformance,
      new RegExp(`^date,returnPct,benchmarkReturnPct\\n${currentYear}-01-01,0,\\n${currentYear}-\\d{2}-\\d{2},0,\\n$`),
    )
    assert.equal(backupFiles.some((fileName) => fileName.startsWith('settings-')), true)
    assert.equal(backupFiles.some((fileName) => fileName.startsWith('performance-')), true)
  })
})
