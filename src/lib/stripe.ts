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

export const PLATFORM_FEE_PERCENT = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || 9)

export function calculatePlatformFee(amount: number): number {
  return Math.round(amount * (PLATFORM_FEE_PERCENT / 100) * 100) / 100
}
