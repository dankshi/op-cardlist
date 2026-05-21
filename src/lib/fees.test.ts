import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePayout,
  tierForGmv,
  TIERS,
  RAW_MARKETPLACE_PERCENT,
  PROCESSING_PERCENT,
} from './fees';

describe('tierForGmv', () => {
  test('boundary mapping matches the published tier ladder', () => {
    assert.equal(tierForGmv(0),       'basic');
    assert.equal(tierForGmv(1_499),   'basic');
    assert.equal(tierForGmv(1_500),   'silver');
    assert.equal(tierForGmv(4_999),   'silver');
    assert.equal(tierForGmv(5_000),   'pearl');
    assert.equal(tierForGmv(24_999),  'pearl');
    assert.equal(tierForGmv(25_000),  'gold');
    assert.equal(tierForGmv(99_999),  'gold');
    assert.equal(tierForGmv(100_000), 'diamond');
    assert.equal(tierForGmv(999_999), 'diamond');
  });

  test('never returns elite (Elite is invite-only, not GMV-driven)', () => {
    for (const gmv of [0, 1_000, 50_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      const tier = tierForGmv(gmv);
      assert.notEqual(tier, 'elite', `tier for $${gmv} was elite`);
    }
  });

  test('negative GMV falls back to basic', () => {
    assert.equal(tierForGmv(-1), 'basic');
  });
});

describe('calculatePayout — fixture from the published table', () => {
  // The user's spec sheet defined exact payouts for a $20 sale. These
  // tests pin the math so any unintentional fee change shows up loudly.

  test('Ship to Nomi · Raw → $12.50 payout (62.5%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'ship', tier: 'basic', isRaw: true });
    assert.equal(r.sellerFee,        5);
    assert.equal(r.marketplaceFee,   1.90);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           12.50);
    assert.equal(r.marketplacePercent, 9.5);
  });

  test('Ship to Nomi · Basic slab → $12.60 payout (63%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'ship', tier: 'basic', isRaw: false });
    assert.equal(r.sellerFee,        5);
    assert.equal(r.marketplaceFee,   1.80);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           12.60);
  });

  test('Ship to Nomi · Diamond slab → $13.00 payout (65%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'ship', tier: 'diamond', isRaw: false });
    assert.equal(r.sellerFee,        5);
    assert.equal(r.marketplaceFee,   1.40);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           13.00);
  });

  test('Drop to Nomi · Raw → $17.50 payout (87.5%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'drop', tier: 'basic', isRaw: true });
    assert.equal(r.sellerFee,        0);
    assert.equal(r.marketplaceFee,   1.90);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           17.50);
  });

  test('Drop to Nomi · Diamond slab → $18.00 payout (90%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'drop', tier: 'diamond', isRaw: false });
    assert.equal(r.sellerFee,        0);
    assert.equal(r.marketplaceFee,   1.40);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           18.00);
  });

  test('P2P · Elite slab → $18.10 payout (90.5%)', () => {
    const r = calculatePayout({ salePrice: 20, fulfillment: 'p2p', tier: 'elite', isRaw: false });
    assert.equal(r.sellerFee,        0);
    assert.equal(r.marketplaceFee,   1.30);
    assert.equal(r.processingFee,    0.60);
    assert.equal(r.payout,           18.10);
  });
});

describe('calculatePayout — raw policy', () => {
  test('raw always pays 9.5% marketplace fee regardless of tier', () => {
    for (const tier of TIERS) {
      if (tier.isP2POnly) continue;
      const r = calculatePayout({ salePrice: 100, fulfillment: 'ship', tier: tier.id, isRaw: true });
      assert.equal(
        r.marketplacePercent,
        RAW_MARKETPLACE_PERCENT,
        `raw card at tier ${tier.id} used ${r.marketplacePercent}% — should always be ${RAW_MARKETPLACE_PERCENT}%`,
      );
    }
  });

  test('slabs pick up the tier-specific %', () => {
    const basic = calculatePayout({ salePrice: 100, fulfillment: 'ship', tier: 'basic',  isRaw: false });
    const gold  = calculatePayout({ salePrice: 100, fulfillment: 'ship', tier: 'gold',   isRaw: false });
    assert.equal(basic.marketplacePercent, 9.0);
    assert.equal(gold.marketplacePercent,  7.5);
    assert.ok(gold.payout > basic.payout, 'gold seller takes home more than basic on the same sale');
  });
});

describe('calculatePayout — edge cases', () => {
  test('zero sale price → zero fees, zero payout, no seller fee', () => {
    const r = calculatePayout({ salePrice: 0, fulfillment: 'ship', tier: 'basic', isRaw: true });
    assert.equal(r.sellerFee,      0);
    assert.equal(r.marketplaceFee, 0);
    assert.equal(r.processingFee,  0);
    assert.equal(r.payout,         0);
    assert.equal(r.payoutRatio,    0);
  });

  test('tiny sale where fees would exceed price → payout clamps to 0, never negative', () => {
    // $1 ship-to-nomi raw: 5 (seller) + 0.10 + 0.03 = 5.13 in fees, but sale was 1.
    // Without clamping the seller would owe money on a sale.
    const r = calculatePayout({ salePrice: 1, fulfillment: 'ship', tier: 'basic', isRaw: true });
    assert.equal(r.payout, 0);
  });

  test('large round-numbered sale matches expected breakdown', () => {
    // $25,000 raw ship-to-nomi: 5 + 2,375 + 750 = 3,130 fees → $21,870 payout
    const r = calculatePayout({ salePrice: 25_000, fulfillment: 'ship', tier: 'basic', isRaw: true });
    assert.equal(r.sellerFee,      5);
    assert.equal(r.marketplaceFee, 2_375);
    assert.equal(r.processingFee,  750);
    assert.equal(r.payout,         21_870);
  });

  test('payoutRatio reports take-home as a fraction of sale price', () => {
    const r = calculatePayout({ salePrice: 1_000, fulfillment: 'ship', tier: 'basic', isRaw: false });
    // $1,000 · (5 + 90 + 30 = 125 fees) → $875 payout → 0.875
    assert.equal(r.payout, 875);
    assert.equal(r.payoutRatio, 0.875);
  });

  test('breakdown sums back to sale price (sellerFee + marketplaceFee + processingFee + payout)', () => {
    for (const sale of [50, 200, 1_500, 12_345]) {
      const r = calculatePayout({ salePrice: sale, fulfillment: 'ship', tier: 'basic', isRaw: false });
      const reconstructed = r.sellerFee + r.marketplaceFee + r.processingFee + r.payout;
      // Floating-point reassembly can drift by sub-cent; require within 1¢.
      assert.ok(
        Math.abs(reconstructed - sale) < 0.01,
        `breakdown reconstruction off for $${sale}: got $${reconstructed.toFixed(4)}`,
      );
    }
  });

  test('processing fee always uses the published rate', () => {
    const r = calculatePayout({ salePrice: 200, fulfillment: 'drop', tier: 'basic', isRaw: false });
    assert.equal(r.processingPercent, PROCESSING_PERCENT);
    assert.equal(r.processingFee, 200 * (PROCESSING_PERCENT / 100));
  });
});
