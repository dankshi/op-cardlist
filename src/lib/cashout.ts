import type { PayoutMethod } from '@/types/database'

export const CASHOUT_MIN_AMOUNT = 10
export const INSTANT_PAYOUT_FEE = 1

export interface CashoutQuote {
  amount: number       // what hits the bank
  fee: number          // service fee retained ($1 instant, $0 standard)
  totalDebited: number // amount + fee — taken from wallet balance
}

export type ValidationFailure =
  | { kind: 'amount_below_min'; min: number }
  | { kind: 'amount_invalid' }
  | { kind: 'method_invalid' }
  | { kind: 'insufficient_balance'; available: number; needed: number }

export type ValidationResult =
  | { ok: true; quote: CashoutQuote }
  | { ok: false; failure: ValidationFailure }

/**
 * Pure validator for a cashout request. Centralised so the route handler
 * and tests share the same money math. The DB enforces amount >= $10
 * separately as a backstop.
 */
export function validateCashoutRequest(args: {
  amount: unknown
  method: unknown
  balance: number
}): ValidationResult {
  const amount = Number(args.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, failure: { kind: 'amount_invalid' } }
  }

  if (args.method !== 'standard' && args.method !== 'instant') {
    return { ok: false, failure: { kind: 'method_invalid' } }
  }

  if (amount < CASHOUT_MIN_AMOUNT) {
    return { ok: false, failure: { kind: 'amount_below_min', min: CASHOUT_MIN_AMOUNT } }
  }

  const quote = quoteCashout(amount, args.method as PayoutMethod)
  if (quote.totalDebited > args.balance) {
    return {
      ok: false,
      failure: {
        kind: 'insufficient_balance',
        available: args.balance,
        needed: quote.totalDebited,
      },
    }
  }

  return { ok: true, quote }
}

export function quoteCashout(amount: number, method: PayoutMethod): CashoutQuote {
  const fee = method === 'instant' ? INSTANT_PAYOUT_FEE : 0
  const totalDebited = round2(amount + fee)
  return { amount: round2(amount), fee, totalDebited }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
