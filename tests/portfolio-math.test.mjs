import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { consolidatePositions, inferStructure, validatePositions, validateSettings } from '../server.mjs'

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
    assert.equal(byTicker(result, 'ABC').value, 200)
    assert.equal(byTicker(result, 'ABC').price, 20)
    assert.equal(byTicker(result, 'ABC').priceSource, 'test')
    assert.equal(byTicker(result, 'ABC').priceFetchedAt, 1)
    assert.equal(byTicker(result, 'ABC').priceStatus, 'live')
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
          baselineInvested: '',
          asOfDate: 'June 18',
          periodStart: '2026-01-01',
          periodEnd: '2026-06-18',
        }),
      (error) => {
        assert.equal(error.statusCode, 400)
        assert.deepEqual(error.validationErrors, [
          'Current book value must be a number.',
          'Beginning book value must be a number.',
          'As-of date must be a YYYY-MM-DD date.',
        ])
        return true
      },
    )
  })
})
