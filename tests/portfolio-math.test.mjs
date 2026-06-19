import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  cleanBenchmarkTicker,
  consolidatePositions,
  inferStructure,
  isoDateInTimeZone,
  migrateLocalDataFiles,
  normalizePerformanceForReport,
  normalizeReportingDates,
  validatePositions,
  validateSettings,
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
