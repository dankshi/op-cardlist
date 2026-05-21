import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
    })
  }
  return _stripe
}

/**
 * @deprecated Tier-aware fee calculation now lives in src/lib/fees.ts.
 * These flat-rate fallbacks remain for any caller that doesn't yet pass
 * seller tier / fulfillment / raw-vs-graded context. Prefer
 * `calculatePayout({ ... })` from `@/lib/fees`.
 */
export const PLATFORM_FEE_PERCENT = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || 9.5)
/** @deprecated See above. */
export const PLATFORM_FEE_FLAT = Number(process.env.STRIPE_PLATFORM_FEE_FLAT || 5)

/** @deprecated Use `calculatePayout` from `@/lib/fees` instead. */
export function calculatePlatformFee(amount: number): number {
  const pct = Math.round(amount * (PLATFORM_FEE_PERCENT / 100) * 100) / 100
  return Math.round((pct + PLATFORM_FEE_FLAT) * 100) / 100
}
