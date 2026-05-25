/**
 * Validation tests for cashout request validation.
 *
 * The cashout flow has side effects across Supabase + Stripe; we keep the
 * money math pure in validateCashoutRequest/quoteCashout so it's testable
 * without mocking either system. The endpoint integration (balance debit,
 * Stripe transfer, rollback) is verified manually via the steps in
 * plans/floating-crafting-lark.md "Verification" section.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CASHOUT_MIN_AMOUNT,
  INSTANT_PAYOUT_FEE,
  quoteCashout,
  validateCashoutRequest,
} from './cashout'

describe('quoteCashout', () => {
  test('standard payout: fee = 0, totalDebited = amount', () => {
    const q = quoteCashout(25, 'standard')
    assert.equal(q.amount, 25)
    assert.equal(q.fee, 0)
    assert.equal(q.totalDebited, 25)
  })

  test('instant payout: fee = $1, totalDebited = amount + 1', () => {
    const q = quoteCashout(25, 'instant')
    assert.equal(q.amount, 25)
    assert.equal(q.fee, INSTANT_PAYOUT_FEE)
    assert.equal(q.totalDebited, 26)
  })

  test('handles fractional cents without float drift', () => {
    const q = quoteCashout(10.1, 'instant')
    assert.equal(q.totalDebited, 11.1)
  })
})

describe('validateCashoutRequest — guards', () => {
  test('rejects non-numeric amount', () => {
    const r = validateCashoutRequest({ amount: 'lots', method: 'standard', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.failure.kind, 'amount_invalid')
  })

  test('rejects zero amount', () => {
    const r = validateCashoutRequest({ amount: 0, method: 'standard', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.failure.kind, 'amount_invalid')
  })

  test('rejects negative amount', () => {
    const r = validateCashoutRequest({ amount: -5, method: 'standard', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.failure.kind, 'amount_invalid')
  })

  test('rejects unknown method', () => {
    const r = validateCashoutRequest({ amount: 25, method: 'lightning', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.failure.kind, 'method_invalid')
  })

  test('rejects amount below $10 minimum', () => {
    const r = validateCashoutRequest({ amount: 9.99, method: 'standard', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.failure.kind, 'amount_below_min')
      if (r.failure.kind === 'amount_below_min') {
        assert.equal(r.failure.min, CASHOUT_MIN_AMOUNT)
      }
    }
  })

  test('rejects when standard amount exceeds balance', () => {
    const r = validateCashoutRequest({ amount: 101, method: 'standard', balance: 100 })
    assert.equal(r.ok, false)
    if (!r.ok && r.failure.kind === 'insufficient_balance') {
      assert.equal(r.failure.available, 100)
      assert.equal(r.failure.needed, 101)
    }
  })

  test('rejects when instant amount + $1 fee exceeds balance', () => {
    // $50 instant needs $51 total; if balance is $50.50 it should fail.
    const r = validateCashoutRequest({ amount: 50, method: 'instant', balance: 50.5 })
    assert.equal(r.ok, false)
    if (!r.ok && r.failure.kind === 'insufficient_balance') {
      assert.equal(r.failure.needed, 51)
    }
  })
})

describe('validateCashoutRequest — happy paths', () => {
  test('exactly $10 standard with $10 balance is allowed', () => {
    const r = validateCashoutRequest({ amount: 10, method: 'standard', balance: 10 })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.quote.amount, 10)
      assert.equal(r.quote.fee, 0)
      assert.equal(r.quote.totalDebited, 10)
    }
  })

  test('exactly $10 instant requires $11 balance', () => {
    const r10 = validateCashoutRequest({ amount: 10, method: 'instant', balance: 10 })
    assert.equal(r10.ok, false, 'should reject — $10 balance cannot cover $10 + $1 fee')
    const r11 = validateCashoutRequest({ amount: 10, method: 'instant', balance: 11 })
    assert.equal(r11.ok, true, 'should accept — $11 covers $10 + $1 fee exactly')
    if (r11.ok) {
      assert.equal(r11.quote.fee, 1)
      assert.equal(r11.quote.totalDebited, 11)
    }
  })

  test('standard cashout of full balance succeeds', () => {
    const r = validateCashoutRequest({ amount: 100, method: 'standard', balance: 100 })
    assert.equal(r.ok, true)
  })
})
