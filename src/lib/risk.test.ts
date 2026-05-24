/**
 * Adversarial tests for src/lib/risk.ts. Each test is designed to FAIL
 * if a specific failure mode regresses.
 *
 * Some tests intentionally document KNOWN limitations (IPv4-mapped IPv6,
 * x-forwarded-for spoofing) — those tests pass against current behavior
 * but they're a signal in PR review: if you tighten the check later,
 * these tests will need to flip from "documents lax behavior" to
 * "enforces strict behavior".
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractClientIp, evaluateOrderRisk, type RiskReason } from './risk'

// ============================================================
// extractClientIp — pure function, exhaustive header coverage
// ============================================================

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://test', { headers })
}

describe('extractClientIp', () => {
  test('x-forwarded-for single IP returns it verbatim', () => {
    assert.equal(extractClientIp(makeReq({ 'x-forwarded-for': '203.0.113.5' })), '203.0.113.5')
  })

  test('x-forwarded-for comma-list returns LEFTMOST (the originating client)', () => {
    // Per spec: leftmost is the original client; subsequent entries are proxies.
    // Returning a later entry would let an attacker spoof by injecting fake
    // hops on the right.
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' })),
      '198.51.100.7',
    )
  })

  test('x-forwarded-for with whitespace is trimmed', () => {
    assert.equal(extractClientIp(makeReq({ 'x-forwarded-for': '   203.0.113.5   , 10.0.0.1' })), '203.0.113.5')
  })

  test('x-forwarded-for empty string falls through to x-real-ip', () => {
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': '', 'x-real-ip': '203.0.113.99' })),
      '203.0.113.99',
    )
  })

  test('x-forwarded-for with only whitespace falls through to x-real-ip', () => {
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': '   ', 'x-real-ip': '203.0.113.99' })),
      '203.0.113.99',
    )
  })

  test('x-forwarded-for with comma but empty leftmost falls through', () => {
    // Edge case: a misbehaving proxy prepends an empty entry. Current
    // code returns '' which is falsy, so we fall through. Good.
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': ', 198.51.100.7', 'x-real-ip': '203.0.113.99' })),
      '203.0.113.99',
    )
  })

  test('no IP headers at all returns null (caller must skip IP-based check)', () => {
    assert.equal(extractClientIp(makeReq({})), null)
  })

  test('x-forwarded-for wins over x-real-ip when both present', () => {
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': '203.0.113.5', 'x-real-ip': '10.0.0.1' })),
      '203.0.113.5',
    )
  })

  test('KNOWN LIMITATION: trusts whatever the client claims in x-forwarded-for', () => {
    // A malicious client can set this header themselves. We have no
    // trusted-proxy whitelist. This test documents the current behavior
    // so a future "fix" (e.g. only trust XFF when behind a known proxy)
    // breaks this test and forces revisit.
    assert.equal(
      extractClientIp(makeReq({ 'x-forwarded-for': 'I-am-spoofing-this' })),
      'I-am-spoofing-this',
    )
  })
})

// ============================================================
// evaluateOrderRisk — needs a mock Supabase
// ============================================================

type Profile = {
  id: string
  created_at: string
  last_login_ip: string | null
  last_seen_at: string | null
  display_name: string | null
}

type Listing = {
  id: string
  seller_id: string
  created_at: string
}

interface Fixtures {
  profiles: Record<string, Profile | null>
  listings: Record<string, Listing | null>
  /** Count of OTHER listings by sellerId (excluding the one being purchased). */
  priorListingCount: Record<string, number>
}

/**
 * Minimal mock Supabase client. Only supports the exact query shapes
 * evaluateOrderRisk uses:
 *   .from('profiles').select(...).eq('id', X).single()
 *   .from('listings').select(...).eq('id', X).single()
 *   .from('listings').select('id', { count: 'exact', head: true })
 *                     .eq('seller_id', X).lt('created_at', Y)
 */
function mockSupabase(fixtures: Fixtures): SupabaseClient {
  return {
    from(table: string) {
      type Query = {
        _isCount: boolean
        _table: string
        _eqs: Record<string, string>
        _lt?: { col: string; val: string }
        select: (cols: string, opts?: { count?: string; head?: boolean }) => Query
        eq: (col: string, val: string) => Query
        lt: (col: string, val: string) => Query
        single: () => Promise<{ data: unknown; error: null }>
        then?: (onFulfilled: (v: { data: null; count: number; error: null }) => unknown) => Promise<unknown>
      }
      const query: Query = {
        _isCount: false,
        _table: table,
        _eqs: {},
        select(_cols, opts) {
          if (opts?.count === 'exact' && opts?.head) this._isCount = true
          return this
        },
        eq(col, val) {
          this._eqs[col] = val
          return this
        },
        lt(col, val) {
          this._lt = { col, val }
          return this
        },
        async single() {
          if (table === 'profiles') {
            return { data: fixtures.profiles[this._eqs.id] ?? null, error: null }
          }
          if (table === 'listings') {
            return { data: fixtures.listings[this._eqs.id] ?? null, error: null }
          }
          return { data: null, error: null }
        },
        // For the priorListingCount query (head: true → awaited without .single())
        // we expose .then so `await query` resolves to { count, ... }
        then(onFulfilled) {
          if (this._isCount && table === 'listings') {
            const sellerId = this._eqs.seller_id
            const count = fixtures.priorListingCount[sellerId] ?? 0
            return Promise.resolve(onFulfilled({ data: null, count, error: null }))
          }
          return Promise.resolve(onFulfilled({ data: null, count: 0, error: null }))
        },
      }
      return query as never
    },
  } as unknown as SupabaseClient
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString()
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p_default',
    created_at: isoMinutesAgo(60 * 24 * 30), // 30 days old by default
    last_login_ip: null,
    last_seen_at: null,
    display_name: 'real-user',
    ...over,
  }
}

// Cast around the read-only NODE_ENV type so we can flip it per-test.
// Next.js's ambient types declare NODE_ENV as a literal union; we need
// to write arbitrary values (including 'Production' typo and unset).
const env = process.env as Record<string, string | undefined>
const originalNodeEnv = env.NODE_ENV
afterEach(() => {
  // node:test doesn't reset env between tests — be explicit.
  env.NODE_ENV = originalNodeEnv
})

describe('evaluateOrderRisk — missing data is safe-fail', () => {
  test('missing buyer profile returns no flag (lets order through, logs)', async () => {
    const sb = mockSupabase({
      profiles: { seller_a: profile({ id: 'seller_a' }) },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60) } },
      priorListingCount: {},
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_missing', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'listing_a',
    })
    assert.deepEqual(r, { flag: false, reasons: [] })
  })

  test('missing listing returns no flag', async () => {
    const sb = mockSupabase({
      profiles: { buyer_a: profile({ id: 'buyer_a' }), seller_a: profile({ id: 'seller_a' }) },
      listings: {},
      priorListingCount: {},
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'missing',
    })
    assert.deepEqual(r, { flag: false, reasons: [] })
  })
})

describe('evaluateOrderRisk — self_dealing_same_ip', () => {
  test('same IP, seller fresh (1 hour) → flags', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 60) }), // 60 days old
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 24 * 60),
          last_login_ip: '203.0.113.5',
          last_seen_at: isoMinutesAgo(60),
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '203.0.113.5', listingId: 'listing_a',
    })
    assert.ok(r.flag)
    assert.ok(r.reasons.includes('self_dealing_same_ip'))
  })

  test('same IP, but seller last_seen 8 days ago → STALE, does not flag', async () => {
    // Critical test: stale IPs shouldn't fire. If we ever loosen the
    // staleness gate, this fails and forces revisit.
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 24 * 60),
          last_login_ip: '203.0.113.5',
          last_seen_at: isoMinutesAgo(60 * 24 * 8), // 8 days
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '203.0.113.5', listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('self_dealing_same_ip'), 'stale IP should not trigger same-IP flag')
  })

  test('buyer IP is null → does not flag (no false positive on missing header)', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 24 * 60),
          last_login_ip: '203.0.113.5',
          last_seen_at: isoMinutesAgo(60),
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('self_dealing_same_ip'))
  })

  test('seller has IP but last_seen_at is null → does not flag (data inconsistency safety)', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 24 * 60),
          last_login_ip: '203.0.113.5',
          last_seen_at: null,
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '203.0.113.5', listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('self_dealing_same_ip'))
  })

  test('KNOWN BUG: IPv4-mapped IPv6 (::ffff:192.168.1.1) does NOT match plain 192.168.1.1', async () => {
    // This is a real defect: same physical machine, different string
    // representations, our string === comparison fails. A self-dealing
    // attacker connecting over IPv6 dodges this check.
    //
    // If you ever fix this (normalize both to IPv4 if mapped), flip
    // assert.ok(!) to assert.ok() and update the comment.
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 24 * 60),
          last_login_ip: '192.168.1.1',
          last_seen_at: isoMinutesAgo(60),
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '::ffff:192.168.1.1', listingId: 'listing_a',
    })
    assert.ok(
      !r.reasons.includes('self_dealing_same_ip'),
      'documents the IPv4-in-IPv6 bug: same IP, different string format, check fails',
    )
  })
})

describe('evaluateOrderRisk — self_dealing_account_proximity', () => {
  test('accounts created 12 hours apart → flags', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 12) }),
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(r.reasons.includes('self_dealing_account_proximity'))
  })

  test('accounts created exactly 24 hours apart → DOES NOT flag (boundary uses strict <)', async () => {
    const buyerCreated = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const sellerCreated = new Date(Date.now()).toISOString()
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: buyerCreated }),
        seller_a: profile({ id: 'seller_a', created_at: sellerCreated }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    // < is strict, so exactly 24h apart should NOT flag. Edge gets the benefit of doubt.
    assert.ok(!r.reasons.includes('self_dealing_account_proximity'))
  })

  test('accounts created 25 hours apart → does not flag', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 25) }),
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { seller_a: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('self_dealing_account_proximity'))
  })

  test('FALSE POSITIVE: two legit users who happened to sign up the same day BOTH get flagged', async () => {
    // Documents the inherent false positive on this signal. A launch day
    // with many signups would trip this for every cross-user transaction.
    // The mitigation is the manual review queue — admin can see it's a
    // coincidence and approve.
    const sb = mockSupabase({
      profiles: {
        legit_buyer: profile({ id: 'legit_buyer', created_at: isoMinutesAgo(60 * 6) }),
        legit_seller: profile({ id: 'legit_seller', created_at: isoMinutesAgo(60 * 8) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'legit_seller', created_at: isoMinutesAgo(60 * 4) } },
      priorListingCount: { legit_seller: 10 }, // established seller — no first-listing-rush
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'legit_buyer', sellerId: 'legit_seller', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(r.flag, 'launch-day coincidence still flags — feature, not bug, given the review queue')
    assert.deepEqual(r.reasons, ['self_dealing_account_proximity'])
  })
})

describe('evaluateOrderRisk — first_listing_rush', () => {
  test('new seller (0 prior listings) + new buyer + fresh listing → flags', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 3) }), // 3 days old
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 60) }), // 60 days old
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(r.reasons.includes('first_listing_rush'))
  })

  test('seller has 1 prior listing → does NOT flag first-listing-rush (track record exists)', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 3) }),
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 1 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('first_listing_rush'))
  })

  test('buyer account 8 days old → does NOT flag (not "new buyer" anymore)', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 8) }), // 8 days
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('first_listing_rush'))
  })

  test('listing 25 hours old → does NOT flag (not "fresh" anymore)', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', created_at: isoMinutesAgo(60 * 24 * 3) }),
        seller_a: profile({ id: 'seller_a', created_at: isoMinutesAgo(60 * 24 * 60) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 25) } }, // 25h
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(!r.reasons.includes('first_listing_rush'))
  })
})

describe('evaluateOrderRisk — buyer === seller (direct API attack)', () => {
  test('same user as buyer and seller → flags via proximity (created 0ms apart)', async () => {
    // Someone hits the payment-intent API with their own user as both
    // buyer and seller — likely an attempt at self-laundering. The UI
    // doesn't let this happen, but the API doesn't explicitly block it.
    // The proximity check catches it (same row → 0ms apart < 24h).
    const sameUser = profile({
      id: 'attacker',
      created_at: isoMinutesAgo(60 * 24 * 365), // 1 year old account
    })
    const sb = mockSupabase({
      profiles: { attacker: sameUser },
      listings: { listing_a: { id: 'listing_a', seller_id: 'attacker', created_at: isoMinutesAgo(60 * 24 * 30) } },
      priorListingCount: { attacker: 5 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'attacker', sellerId: 'attacker', buyerIp: null, listingId: 'listing_a',
    })
    assert.ok(r.flag)
    assert.ok(r.reasons.includes('self_dealing_account_proximity'))
  })
})

describe('evaluateOrderRisk — NODE_ENV bypass (security-critical)', () => {
  test("bypass fires in dev when display_name='test'", async () => {
    env.NODE_ENV = 'development'
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', display_name: 'test', created_at: isoMinutesAgo(60 * 12) }),
        seller_a: profile({ id: 'seller_a', display_name: 'real', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'listing_a',
    })
    // Would otherwise flag account_proximity + first_listing_rush.
    assert.deepEqual(r, { flag: false, reasons: [] })
  })

  test("bypass does NOT fire in production even with display_name='test'", async () => {
    // Critical: if NODE_ENV is correctly set to 'production', a user
    // who picked display_name='test' can't dodge fraud checks.
    env.NODE_ENV = 'production'
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', display_name: 'test', created_at: isoMinutesAgo(60 * 12) }),
        seller_a: profile({ id: 'seller_a', display_name: 'real', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'listing_a',
    })
    assert.ok(r.flag, 'production must enforce all rules regardless of display_name')
  })

  test('SECURITY GOTCHA: NODE_ENV unset (undefined) → bypass fires (dev-mode default)', async () => {
    // NODE_ENV undefined is treated as "not production", so the bypass
    // is active. If you accidentally deploy without setting NODE_ENV,
    // any user-picked display_name='test' dodges fraud checks. This
    // test exists to make sure that fact is visible in CI output.
    delete env.NODE_ENV
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', display_name: 'test', created_at: isoMinutesAgo(60 * 12) }),
        seller_a: profile({ id: 'seller_a', display_name: 'real', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'listing_a',
    })
    assert.deepEqual(r, { flag: false, reasons: [] }, 'bypass fires when NODE_ENV is unset — deploy-time hazard')
  })

  test("SECURITY GOTCHA: typo'd 'Production' (capital P) → bypass fires", async () => {
    // strict === 'production' comparison means any typo or capitalisation
    // mistake leaves the bypass active.
    env.NODE_ENV = 'Production'
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({ id: 'buyer_a', display_name: 'test', created_at: isoMinutesAgo(60 * 12) }),
        seller_a: profile({ id: 'seller_a', display_name: 'real', created_at: isoMinutesAgo(0) }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 12) } },
      priorListingCount: { seller_a: 0 },
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '1.2.3.4', listingId: 'listing_a',
    })
    assert.deepEqual(r, { flag: false, reasons: [] }, 'typo in NODE_ENV value bypasses fraud — strict equality hazard')
  })
})

describe('evaluateOrderRisk — multiple signals stack', () => {
  test('all three signals fire together → returns all three reasons', async () => {
    const sb = mockSupabase({
      profiles: {
        buyer_a: profile({
          id: 'buyer_a',
          created_at: isoMinutesAgo(60 * 12), // 12h old (new buyer)
        }),
        seller_a: profile({
          id: 'seller_a',
          created_at: isoMinutesAgo(60 * 6), // 6h old (proximity)
          last_login_ip: '203.0.113.5',
          last_seen_at: isoMinutesAgo(30),
        }),
      },
      listings: { listing_a: { id: 'listing_a', seller_id: 'seller_a', created_at: isoMinutesAgo(60 * 2) } }, // 2h fresh
      priorListingCount: { seller_a: 0 }, // first listing
    })
    const r = await evaluateOrderRisk(sb, {
      buyerId: 'buyer_a', sellerId: 'seller_a', buyerIp: '203.0.113.5', listingId: 'listing_a',
    })
    assert.ok(r.flag)
    const expected: RiskReason[] = ['self_dealing_same_ip', 'self_dealing_account_proximity', 'first_listing_rush']
    for (const reason of expected) {
      assert.ok(r.reasons.includes(reason), `expected ${reason} in reasons: ${JSON.stringify(r.reasons)}`)
    }
  })
})
