import fs from 'fs';
import path from 'path';
import { supabase } from '@/lib/supabase';

interface PriceSnapshot {
  date: string;
  cardCount: number;
  prices: Record<string, number>;
}

interface PriceChange {
  cardId: string;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePercent: number;
}

const PRICE_HISTORY_DIR = path.join(process.cwd(), 'data', 'price-history');

/**
 * Get all available price history files sorted by date (newest first)
 */
export function getPriceHistoryFiles(): string[] {
  try {
    const files = fs.readdirSync(PRICE_HISTORY_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Newest first
  } catch {
    return [];
  }
}

/**
 * Load a price snapshot by filename
 */
export function loadPriceSnapshot(filename: string): PriceSnapshot | null {
  try {
    const filePath = path.join(PRICE_HISTORY_DIR, filename);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as PriceSnapshot;
  } catch {
    return null;
  }
}

/**
 * Get price from N days ago for a specific card
 */
export function getPriceFromDaysAgo(cardId: string, daysAgo: number): number | null {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) return null;

  const snapshot = loadPriceSnapshot(files[daysAgo]);
  if (!snapshot) return null;

  return snapshot.prices[cardId] ?? null;
}

/**
 * Calculate price change for a card over N days (Supabase)
 */
export async function calculatePriceChange(
  cardId: string,
  currentPrice: number | null,
  daysAgo: number = 7
): Promise<PriceChange | null> {
  if (currentPrice == null || !supabase) return null;

  // Look up tcgplayer_product_id via card_tcgplayer_mapping. This used to
  // read from tcgplayer_card_prices.tcgplayer_product_id but that column
  // was dropped in migration 20260528; before this fix, calculatePriceChange
  // returned null for every card.
  const { data: mapping } = await supabase
    .from('card_tcgplayer_mapping')
    .select('tcgplayer_product_id')
    .eq('card_id', cardId)
    .single();

  if (!mapping?.tcgplayer_product_id) return null;

  // Get the price from ~N days ago
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  const dateStr = targetDate.toISOString().split('T')[0];

  const { data: row } = await supabase
    .from('tcgplayer_card_price_history')
    .select('market_price')
    .eq('tcgplayer_product_id', mapping.tcgplayer_product_id)
    .lte('recorded_date', dateStr)
    .order('recorded_date', { ascending: false })
    .limit(1)
    .single();

  if (!row?.market_price) return null;

  const previousPrice = Number(row.market_price);
  const change = currentPrice - previousPrice;
  const changePercent = previousPrice > 0 ? ((change / previousPrice) * 100) : 0;

  return {
    cardId,
    currentPrice,
    previousPrice,
    change,
    changePercent,
  };
}

/**
 * Get top price movers (biggest gainers and losers)
 */
export function getTopPriceMovers(
  currentPrices: Record<string, number>,
  daysAgo: number = 7,
  limit: number = 10
): { gainers: PriceChange[]; losers: PriceChange[] } {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) {
    return { gainers: [], losers: [] };
  }

  const previousSnapshot = loadPriceSnapshot(files[daysAgo]);
  if (!previousSnapshot) {
    return { gainers: [], losers: [] };
  }

  const changes: PriceChange[] = [];

  for (const [cardId, currentPrice] of Object.entries(currentPrices)) {
    const previousPrice = previousSnapshot.prices[cardId];
    if (previousPrice == null || previousPrice === 0) continue;

    const change = currentPrice - previousPrice;
    const changePercent = (change / previousPrice) * 100;

    // Only include significant changes (> 5%)
    if (Math.abs(changePercent) >= 5) {
      changes.push({
        cardId,
        currentPrice,
        previousPrice,
        change,
        changePercent,
      });
    }
  }

  // Sort by percentage change
  const sorted = changes.sort((a, b) => b.changePercent - a.changePercent);

  return {
    gainers: sorted.filter(c => c.changePercent > 0).slice(0, limit),
    losers: sorted.filter(c => c.changePercent < 0).slice(0, limit).reverse(),
  };
}

/**
 * Calculate price changes for all cards in a single batch (reads filesystem ONCE).
 * Returns only significant changes (>= 5%).
 */
export function calculateBatchPriceChanges(
  currentPrices: Record<string, number>,
  daysAgo: number = 7
): Record<string, number> {
  const files = getPriceHistoryFiles();
  if (files.length <= daysAgo) return {};

  const previousSnapshot = loadPriceSnapshot(files[daysAgo]);
  if (!previousSnapshot) return {};

  const changes: Record<string, number> = {};

  for (const [cardId, currentPrice] of Object.entries(currentPrices)) {
    const previousPrice = previousSnapshot.prices[cardId];
    if (previousPrice == null || previousPrice === 0) continue;

    const changePercent =
      ((currentPrice - previousPrice) / previousPrice) * 100;

    if (Math.abs(changePercent) >= 5) {
      changes[cardId] = changePercent;
    }
  }

  return changes;
}

/**
 * Get price history for a specific card (last N days) from Supabase
 */
export async function getCardPriceHistory(
  cardId: string,
  days: number = 30
): Promise<{ date: string; price: number }[]> {
  if (!supabase) return [];

  // Look up tcgplayer_product_id via card_tcgplayer_mapping (see
  // calculatePriceChange for the original migration story).
  const { data: mapping } = await supabase
    .from('card_tcgplayer_mapping')
    .select('tcgplayer_product_id')
    .eq('card_id', cardId)
    .single();

  if (!mapping?.tcgplayer_product_id) return [];

  // Query price history for the last N days
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const dateStr = startDate.toISOString().split('T')[0];

  const { data: rows } = await supabase
    .from('tcgplayer_card_price_history')
    .select('recorded_date, market_price')
    .eq('tcgplayer_product_id', mapping.tcgplayer_product_id)
    .gte('recorded_date', dateStr)
    .order('recorded_date', { ascending: true });

  if (!rows) return [];

  return rows
    .filter(r => r.market_price != null)
    .map(r => ({
      date: r.recorded_date,
      price: Number(r.market_price),
    }));
}

export interface SalePoint {
  date: string;
  price: number;
  condition: string | null;
  variant: string | null;
  language: string | null;
  listing_type: string | null;
  custom_listing_id: string | null;
  quantity: number;
}

export type GradingCompany = 'PSA' | 'CGC' | 'BGS' | 'TAG';

export interface GradedSalePoint {
  date: string;
  price: number;
  grading_company: GradingCompany;
  grade: string;
  title: string;
  listing_url: string | null;
  listing_format: string | null;
}

/**
 * Get individual sales for a card from Supabase card_sales table
 */
export async function getCardSales(
  cardId: string,
  days: number = 30
): Promise<SalePoint[]> {
  if (!supabase) return [];

  const { data: mapping } = await supabase
    .from('card_tcgplayer_mapping')
    .select('tcgplayer_product_id')
    .eq('card_id', cardId)
    .single();

  if (!mapping?.tcgplayer_product_id) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: rows } = await supabase
    .from('card_sales')
    .select('sold_at, price, condition, variant, language, listing_type, custom_listing_id, quantity')
    .eq('tcgplayer_product_id', mapping.tcgplayer_product_id)
    .gte('sold_at', startDate.toISOString())
    .order('sold_at', { ascending: true });

  if (!rows) return [];

  return rows.map(r => ({
    date: r.sold_at,
    price: Number(r.price),
    condition: r.condition,
    variant: r.variant ?? null,
    language: r.language ?? null,
    listing_type: r.listing_type ?? null,
    custom_listing_id: r.custom_listing_id ?? null,
    quantity: r.quantity ?? 1,
  }));
}

export type GradeCompany = 'PSA' | 'BGS' | 'CGC' | 'TAG';

export interface PopulationBucket {
  grade: string;
  count: number;
}

/**
 * Get the population (census) counts for a card, grouped by grading company.
 * Returns { PSA: [...], BGS: [...], ... } — companies with no data omitted.
 *
 * Reads from per-company pops_<company> tables. Today only pops_psa
 * exists; add pops_bgs / pops_cgc / pops_tag here as they're built.
 */
export async function getCardPopulations(
  cardId: string,
): Promise<Partial<Record<GradeCompany, PopulationBucket[]>>> {
  if (!supabase) return {};

  const { data: psaRow } = await supabase
    .from('pops_psa')
    .select('grade_10, grade_9, grade_8, grade_7')
    .eq('card_id', cardId)
    .maybeSingle();

  if (!psaRow) return {};

  const psa: PopulationBucket[] = [
    { grade: '10', count: Number(psaRow.grade_10 ?? 0) },
    { grade: '9',  count: Number(psaRow.grade_9  ?? 0) },
    { grade: '8',  count: Number(psaRow.grade_8  ?? 0) },
    { grade: '7',  count: Number(psaRow.grade_7  ?? 0) },
  ];

  return { PSA: psa };
}

export interface CardPsaInfo {
  spec_id: number;
  description: string | null;
  set_code: string | null;
}

/**
 * Get the PSA spec record for a card — id + description. Used by the
 * debug-names section on the card page so we can spot-check that the
 * bandai / TCGplayer / PSA names actually refer to the same physical
 * card, and link directly to PSA / TCGplayer for verification.
 * Returns null when the card has no pops_psa mapping.
 */
export async function getCardPsaInfo(cardId: string): Promise<CardPsaInfo | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('pops_psa')
    .select('spec_id, description, set_code')
    .eq('card_id', cardId)
    .maybeSingle();
  return data ? {
    spec_id: Number(data.spec_id),
    description: data.description,
    set_code: data.set_code ?? null,
  } : null;
}

/**
 * Get graded (slabbed) card sales from eBay scraper data.
 */
export async function getCardGradedSales(
  cardId: string,
  days: number = 90,
): Promise<GradedSalePoint[]> {
  if (!supabase) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: rows } = await supabase
    .from('slab_sales')
    .select('sold_at, price, grading_company, grade, title, listing_url, listing_format')
    .eq('card_id', cardId)
    .eq('status', 'visible')
    .eq('sale_kind', 'sold') // exclude still-active listings (GTC/relisted) — not real sales
    .gte('sold_at', startDate.toISOString())
    .order('sold_at', { ascending: true });

  if (!rows) return [];

  return rows.map(r => ({
    date: r.sold_at,
    price: Number(r.price),
    grading_company: r.grading_company as GradingCompany,
    grade: r.grade,
    title: r.title,
    listing_url: r.listing_url,
    listing_format: r.listing_format,
  }));
}

/**
 * The comp-engine output for one card: the authoritative market value per
 * graded variant, keyed by `${gradingCompany} ${grade}` (e.g. "PSA 10").
 * Reads slab_market_values, then lets a slab_value_overrides row win — the
 * same "a human can overrule the machine" pattern as manual TCGplayer mappings.
 * Returns an empty map when the card has no computed graded values.
 */
export interface SlabValue {
  gradingCompany: GradingCompany;
  grade: string;
  marketValue: number | null;
  lastSoldPrice: number | null;
  lastSoldAt: string | null;
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  trend30dPct: number | null;
  isOverride: boolean;
}

export async function getCardSlabValues(cardId: string): Promise<Map<string, SlabValue>> {
  const out = new Map<string, SlabValue>();
  if (!supabase) return out;

  const [valuesRes, overridesRes] = await Promise.all([
    supabase
      .from('slab_market_values')
      .select('grading_company, grade, market_value, last_sold_price, last_sold_at, sample_size, confidence, trend_30d_pct')
      .eq('card_id', cardId),
    supabase
      .from('slab_value_overrides')
      .select('grading_company, grade, value')
      .eq('card_id', cardId),
  ]);

  for (const r of valuesRes.data ?? []) {
    const key = `${r.grading_company} ${r.grade}`;
    out.set(key, {
      gradingCompany: r.grading_company as GradingCompany,
      grade: r.grade,
      marketValue: r.market_value == null ? null : Number(r.market_value),
      lastSoldPrice: r.last_sold_price == null ? null : Number(r.last_sold_price),
      lastSoldAt: r.last_sold_at,
      sampleSize: Number(r.sample_size ?? 0),
      confidence: (r.confidence ?? 'none') as SlabValue['confidence'],
      trend30dPct: r.trend_30d_pct == null ? null : Number(r.trend_30d_pct),
      isOverride: false,
    });
  }

  // Overrides win; they may also exist for variants with no computed value.
  for (const r of overridesRes.data ?? []) {
    const key = `${r.grading_company} ${r.grade}`;
    const existing = out.get(key);
    out.set(key, {
      gradingCompany: r.grading_company as GradingCompany,
      grade: r.grade,
      marketValue: Number(r.value),
      lastSoldPrice: existing?.lastSoldPrice ?? null,
      lastSoldAt: existing?.lastSoldAt ?? null,
      sampleSize: existing?.sampleSize ?? 0,
      confidence: existing?.confidence ?? 'none',
      trend30dPct: existing?.trend30dPct ?? null,
      isOverride: true,
    });
  }

  return out;
}
