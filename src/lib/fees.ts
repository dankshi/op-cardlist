/**
 * Single source of truth for marketplace pricing.
 * Used by the home-page chart, the payout calculator, and any future
 * tier-aware backend fee calculation.
 *
 * NOTE: src/lib/stripe.ts still uses the simpler 9.5% + $5 model for actual
 * Stripe Connect application_fee_amount today. To respect tiers in real
 * charges, the payment flow needs to look up the seller's tier and the
 * listing's fulfillment method, then call calculatePayout() here.
 */

export type FulfillmentId = 'ship' | 'drop' | 'p2p';
export type TierId = 'basic' | 'silver' | 'pearl' | 'gold' | 'diamond' | 'elite';

export interface Tier {
  id: TierId;
  name: string;
  gmvRange: string;
  /** Lifetime GMV at which a seller qualifies for this tier. P2P-only tiers leave this undefined. */
  gmvFloor?: number;
  marketplacePercent: number;
  isP2POnly?: boolean;
  highlight?: boolean;
}

export interface FulfillmentMethod {
  id: FulfillmentId;
  name: string;
  tagline: string;
  sellerFee: number;
  bestFor: string;
  requiresElite?: boolean;
}

export const TIERS: Tier[] = [
  { id: 'basic',   name: 'Basic',   gmvRange: '$0 – $1,499',      gmvFloor: 0,       marketplacePercent: 9.0 },
  { id: 'silver',  name: 'Silver',  gmvRange: '$1,500 – $4,999',  gmvFloor: 1_500,   marketplacePercent: 8.5 },
  { id: 'pearl',   name: 'Pearl',   gmvRange: '$5,000 – $24,999', gmvFloor: 5_000,   marketplacePercent: 8.0 },
  { id: 'gold',    name: 'Gold',    gmvRange: '$25,000 – $99,999',gmvFloor: 25_000,  marketplacePercent: 7.5, highlight: true },
  { id: 'diamond', name: 'Diamond', gmvRange: '$100,000+',        gmvFloor: 100_000, marketplacePercent: 7.0 },
  { id: 'elite',   name: 'Elite',   gmvRange: 'P2P only',                            marketplacePercent: 6.5, isP2POnly: true },
];

export const FULFILLMENT: FulfillmentMethod[] = [
  {
    id: 'ship',
    name: 'Ship to Nomi',
    tagline: 'Mail us your cards',
    sellerFee: 5,
    bestFor: 'Anyone selling from home',
  },
  {
    id: 'drop',
    name: 'Drop to Nomi',
    tagline: 'Drop off in person',
    sellerFee: 0,
    bestFor: 'Sellers near our facility',
  },
  {
    id: 'p2p',
    name: 'P2P',
    tagline: 'Direct buyer-to-seller',
    sellerFee: 0,
    bestFor: 'High-trust Elite sellers',
    requiresElite: true,
  },
];

/** Marketplace % for raw (ungraded) cards — flat across every tier. */
export const RAW_MARKETPLACE_PERCENT = 9.5;
/** Stripe processing fee passed through on every sale. */
export const PROCESSING_PERCENT = 3.0;

export function getTier(id: TierId): Tier {
  const found = TIERS.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown tier: ${id}`);
  return found;
}

/**
 * Auto-promotion mapping: lifetime GMV → seller tier. Picks the highest
 * tier whose gmvFloor the seller has crossed. P2P-only tiers (Elite) are
 * excluded — those require manual approval, not GMV thresholds.
 */
export function tierForGmv(gmv: number): TierId {
  const eligible = TIERS.filter((t) => !t.isP2POnly && t.gmvFloor != null)
    .sort((a, b) => (b.gmvFloor ?? 0) - (a.gmvFloor ?? 0));
  for (const tier of eligible) {
    if (gmv >= (tier.gmvFloor ?? 0)) return tier.id;
  }
  return 'basic';
}

export function getFulfillment(id: FulfillmentId): FulfillmentMethod {
  const found = FULFILLMENT.find((f) => f.id === id);
  if (!found) throw new Error(`Unknown fulfillment: ${id}`);
  return found;
}

export interface PayoutBreakdown {
  salePrice: number;
  sellerFee: number;
  marketplaceFee: number;
  marketplacePercent: number;
  processingFee: number;
  processingPercent: number;
  payout: number;
  payoutRatio: number;
}

export interface PayoutInput {
  salePrice: number;
  fulfillment: FulfillmentId;
  tier: TierId;
  isRaw: boolean;
}

export function calculatePayout({ salePrice, fulfillment, tier, isRaw }: PayoutInput): PayoutBreakdown {
  const f = getFulfillment(fulfillment);
  const t = getTier(tier);

  const marketplacePercent = isRaw ? RAW_MARKETPLACE_PERCENT : t.marketplacePercent;
  const sellerFee = salePrice > 0 ? f.sellerFee : 0;
  const marketplaceFee = round2(salePrice * (marketplacePercent / 100));
  const processingFee = round2(salePrice * (PROCESSING_PERCENT / 100));
  const payout = Math.max(0, round2(salePrice - sellerFee - marketplaceFee - processingFee));
  const payoutRatio = salePrice > 0 ? payout / salePrice : 0;

  return {
    salePrice,
    sellerFee,
    marketplaceFee,
    marketplacePercent,
    processingFee,
    processingPercent: PROCESSING_PERCENT,
    payout,
    payoutRatio,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
