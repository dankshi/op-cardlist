/**
 * Marketplace-specific fraud signals that Stripe Radar can't see.
 *
 * Stripe Radar handles payment-instrument risk (stolen cards, card-testing
 * bots, geo mismatches). It doesn't know about buyer/seller relationships
 * inside our marketplace, so we layer these custom checks on top at order-
 * creation time. If any signal fires, we set the order to `under_review`
 * proactively — Stripe Radar still evaluates the charge in parallel.
 *
 * Returns `{ flag, reasons }`. Reasons are stable string codes stored in
 * orders.auto_flagged_reasons (jsonb) so the /admin/risk inbox can show
 * exactly why each order was flagged.
 *
 * See designs/stripe-radar.md for the threshold philosophy.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type RiskReason =
  | 'self_dealing_same_ip'
  | 'self_dealing_account_proximity'
  | 'first_listing_rush'

export interface RiskEvaluation {
  flag: boolean
  reasons: RiskReason[]
}

interface EvaluateArgs {
  buyerId: string
  sellerId: string
  /** IP address of the buyer's current request (from x-forwarded-for, etc). */
  buyerIp: string | null
  /** The listing being purchased — needed for first-listing-rush check. */
  listingId: string
}

/**
 * Maximum age in ms for `profiles.last_login_ip` to be trusted as the
 * seller's "current" IP. Older than this and the seller might have moved
 * networks (home → coffee shop), making the comparison unreliable.
 */
const SELLER_IP_STALENESS_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Window for "buyer and seller accounts created close together" — a strong
 * self-dealing signal if both were created within this period. Picks up the
 * common pattern of one bad actor spinning up paired accounts in one session.
 */
const ACCOUNT_PROXIMITY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Window for "first-listing rush" — seller's first-ever listing transacting
 * within this window of being posted is a coordinated-fraud signal,
 * especially paired with a brand-new buyer account.
 */
const FIRST_LISTING_RUSH_MS = 24 * 60 * 60 * 1000 // 24 hours
const NEW_BUYER_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function evaluateOrderRisk(
  supabase: SupabaseClient,
  args: EvaluateArgs,
): Promise<RiskEvaluation> {
  const reasons: RiskReason[] = []

  const [buyerRes, sellerRes, listingRes] = await Promise.all([
    supabase.from('profiles')
      .select('id, created_at, last_login_ip, last_seen_at')
      .eq('id', args.buyerId)
      .single(),
    supabase.from('profiles')
      .select('id, created_at, last_login_ip, last_seen_at')
      .eq('id', args.sellerId)
      .single(),
    supabase.from('listings')
      .select('id, seller_id, created_at')
      .eq('id', args.listingId)
      .single(),
  ])

  const buyer = buyerRes.data
  const seller = sellerRes.data
  const listing = listingRes.data
  if (!buyer || !seller || !listing) {
    // Missing data — don't flag (don't block legit orders on a query miss),
    // but log so this surfaces in error monitoring.
    console.error('[risk] missing profile or listing for evaluation', args)
    return { flag: false, reasons: [] }
  }

  // 1. Same-IP self-dealing. Strongest signal — buyer and seller IPs match
  //    at the time the buyer is placing the order. Only trust the seller's
  //    last_login_ip if it's recent enough that they're likely still there.
  if (args.buyerIp && seller.last_login_ip && seller.last_seen_at) {
    const sellerSeenAt = new Date(seller.last_seen_at).getTime()
    const fresh = Date.now() - sellerSeenAt < SELLER_IP_STALENESS_MS
    if (fresh && seller.last_login_ip === args.buyerIp) {
      reasons.push('self_dealing_same_ip')
    }
  }

  // 2. Account-creation proximity. Buyer and seller accounts both created
  //    within 24hrs of each other = classic paired-account fraud pattern.
  const buyerCreated = new Date(buyer.created_at).getTime()
  const sellerCreated = new Date(seller.created_at).getTime()
  if (Math.abs(buyerCreated - sellerCreated) < ACCOUNT_PROXIMITY_MS) {
    reasons.push('self_dealing_account_proximity')
  }

  // 3. First-listing rush. Seller's listing is brand-new (< 24hrs old) AND
  //    the buyer's account is brand-new (< 7 days old). Either alone is
  //    fine — together they're a coordinated-fraud signature.
  const listingCreated = new Date(listing.created_at).getTime()
  const listingFresh = Date.now() - listingCreated < FIRST_LISTING_RUSH_MS
  const buyerNew = Date.now() - buyerCreated < NEW_BUYER_MS
  if (listingFresh && buyerNew) {
    // Confirm it's actually the seller's first listing — a seller with many
    // listings has track record, so a new listing alone isn't suspicious.
    const { count } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', args.sellerId)
      .lt('created_at', listing.created_at)
    if ((count ?? 0) === 0) {
      reasons.push('first_listing_rush')
    }
  }

  return {
    flag: reasons.length > 0,
    reasons,
  }
}

/**
 * Extract the originating client IP from a Next.js Request. Honors
 * `x-forwarded-for` (first hop) and falls back to `x-real-ip`. Returns
 * null when neither is present so callers can skip the IP-based check.
 */
export function extractClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // x-forwarded-for can be a comma-separated chain; the leftmost is the
    // original client (subsequent entries are proxies between client and us).
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  return real ?? null
}
