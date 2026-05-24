/**
 * Adversarial tests for cancelOrderWithRefund. Focus areas:
 *   1. Idempotency (webhook delivery duplicates must not double-refund)
 *   2. State guards (don't cancel finalised states)
 *   3. Missing-data safety (deleted profile, missing listing)
 *   4. Credit refund branching (0 credits skips DB write entirely)
 *   5. Multi-item orders (loop must handle each)
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cancelOrderWithRefund } from './orderCancel'

type OrderRow = {
  id: string
  buyer_id: string | null
  status: string
  credits_applied: number
  inventory_reserved: boolean
  items: { listing_id: string; quantity: number }[]
}

type ListingRow = {
  status: 'active' | 'reserved' | 'sold' | 'delisted'
  quantity_available: number
}

type ProfileRow = { balance: number }

interface Fixtures {
  orders: Record<string, OrderRow | null>
  listings: Record<string, ListingRow | null>
  profiles: Record<string, ProfileRow | null>
}

interface Calls {
  listingUpdates: { id: string; payload: Partial<ListingRow> }[]
  profileUpdates: { id: string; payload: Partial<ProfileRow> }[]
  creditTransactionInserts: Record<string, unknown>[]
  orderUpdates: { id: string; payload: Record<string, unknown> }[]
}

function mockSupabase(fixtures: Fixtures): { sb: SupabaseClient; calls: Calls } {
  const calls: Calls = {
    listingUpdates: [],
    profileUpdates: [],
    creditTransactionInserts: [],
    orderUpdates: [],
  }

  const sb = {
    from(table: string) {
      type Query = {
        _eqs: Record<string, string>
        _payload?: Record<string, unknown>
        _op: 'select' | 'update' | 'insert'
        select: (cols: string) => Query
        update: (payload: Record<string, unknown>) => Query
        insert: (payload: Record<string, unknown>) => Promise<{ data: null; error: null }>
        eq: (col: string, val: string) => Query
        single: () => Promise<{ data: unknown; error: null }>
        then?: (onFulfilled: (v: { data: null; error: null }) => unknown) => Promise<unknown>
      }
      const query: Query = {
        _eqs: {},
        _op: 'select',
        select(_cols) {
          this._op = 'select'
          return this
        },
        update(payload) {
          this._op = 'update'
          this._payload = payload
          return this
        },
        async insert(payload) {
          if (table === 'credit_transactions') {
            calls.creditTransactionInserts.push(payload)
          }
          return { data: null, error: null }
        },
        eq(col, val) {
          this._eqs[col] = val
          return this
        },
        async single() {
          if (table === 'orders') {
            return { data: fixtures.orders[this._eqs.id] ?? null, error: null }
          }
          if (table === 'listings') {
            return { data: fixtures.listings[this._eqs.id] ?? null, error: null }
          }
          if (table === 'profiles') {
            return { data: fixtures.profiles[this._eqs.id] ?? null, error: null }
          }
          return { data: null, error: null }
        },
        then(onFulfilled) {
          // Awaited update without .single() resolves here.
          if (this._op === 'update' && this._payload) {
            if (table === 'listings') {
              calls.listingUpdates.push({ id: this._eqs.id, payload: this._payload as Partial<ListingRow> })
            } else if (table === 'profiles') {
              calls.profileUpdates.push({ id: this._eqs.id, payload: this._payload as Partial<ProfileRow> })
            } else if (table === 'orders') {
              calls.orderUpdates.push({ id: this._eqs.id, payload: this._payload })
            }
          }
          return Promise.resolve(onFulfilled({ data: null, error: null }))
        },
      }
      return query as never
    },
  } as unknown as SupabaseClient

  return { sb, calls }
}

const baseOrder = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'order_a',
  buyer_id: 'buyer_a',
  status: 'under_review',
  credits_applied: 0,
  inventory_reserved: true,
  items: [{ listing_id: 'listing_a', quantity: 1 }],
  ...over,
})

describe('cancelOrderWithRefund — idempotency (critical for webhooks)', () => {
  test('order already cancelled → no-op (no listing updates, no credit refund)', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ status: 'cancelled', credits_applied: 10 }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'second-call')
    assert.equal(calls.listingUpdates.length, 0)
    assert.equal(calls.profileUpdates.length, 0)
    assert.equal(calls.creditTransactionInserts.length, 0)
    assert.equal(calls.orderUpdates.length, 0, 'must not re-update an already-cancelled order')
  })

  test('order already refunded → no-op', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ status: 'refunded', credits_applied: 10 }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'second-call')
    assert.equal(calls.listingUpdates.length, 0)
    assert.equal(calls.creditTransactionInserts.length, 0)
  })

  test('missing order → no-op (defensive)', async () => {
    const { sb, calls } = mockSupabase({
      orders: {},
      listings: {},
      profiles: {},
    })
    await cancelOrderWithRefund(sb, 'does_not_exist', 'whatever')
    assert.equal(calls.orderUpdates.length, 0)
  })
})

describe('cancelOrderWithRefund — inventory release', () => {
  test('inventory_reserved=true releases the listing back to active', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ items: [{ listing_id: 'listing_a', quantity: 1 }] }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    const lu = calls.listingUpdates.find(u => u.id === 'listing_a')
    assert.ok(lu, 'listing should be updated')
    assert.deepEqual(lu.payload, { quantity_available: 1, status: 'active' })
  })

  test('inventory_reserved=false (legacy order) skips inventory release', async () => {
    // Pre-reservation orders never decremented stock, so releasing
    // would be a phantom restore — give the listing extra inventory
    // it never had.
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ inventory_reserved: false }) },
      listings: { listing_a: { status: 'active', quantity_available: 5 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.listingUpdates.length, 0, 'no phantom inventory restore on legacy order')
  })

  test('multi-item order releases each listing independently', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({
        items: [
          { listing_id: 'listing_a', quantity: 1 },
          { listing_id: 'listing_b', quantity: 2 },
        ],
      }) },
      listings: {
        listing_a: { status: 'reserved', quantity_available: 0 },
        listing_b: { status: 'active', quantity_available: 3 },
      },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.listingUpdates.length, 2)
    assert.ok(calls.listingUpdates.find(u => u.id === 'listing_a' && u.payload.quantity_available === 1))
    assert.ok(calls.listingUpdates.find(u => u.id === 'listing_b' && u.payload.quantity_available === 5))
  })

  test('missing listing in a multi-item order does NOT crash, others still release', async () => {
    // Defensive: if a listing was hard-deleted between order creation
    // and cancel, we shouldn't fail the whole refund — just skip that one.
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({
        items: [
          { listing_id: 'listing_gone', quantity: 1 },
          { listing_id: 'listing_b', quantity: 1 },
        ],
      }) },
      listings: {
        listing_gone: null,
        listing_b: { status: 'reserved', quantity_available: 0 },
      },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.listingUpdates.length, 1, 'only the surviving listing should be updated')
    assert.equal(calls.listingUpdates[0].id, 'listing_b')
  })

  test('listing in sold status → releaseReservation returns null, no update issued', async () => {
    // Buyer race: by the time cancel fires, the listing already shows
    // as sold (e.g. a faster buyer finalized). Don't resurrect inventory
    // the seller no longer has.
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder() },
      listings: { listing_a: { status: 'sold', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.listingUpdates.length, 0, 'sold listings stay sold')
  })
})

describe('cancelOrderWithRefund — credit refund', () => {
  test('credits_applied=0 → no profile update, no credit_transactions insert', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ credits_applied: 0 }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.profileUpdates.length, 0)
    assert.equal(calls.creditTransactionInserts.length, 0)
  })

  test('credits_applied > 0 → balance restored + credit_transactions row written', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ credits_applied: 15 }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 35 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'review_refund')

    // Balance updated from 35 → 50
    const pu = calls.profileUpdates.find(u => u.id === 'buyer_a')
    assert.ok(pu)
    assert.equal(pu.payload.balance, 50)

    // Ledger row inserted with correct type + amount
    assert.equal(calls.creditTransactionInserts.length, 1)
    const ledger = calls.creditTransactionInserts[0]
    assert.equal(ledger.user_id, 'buyer_a')
    assert.equal(ledger.amount, 15)
    assert.equal(ledger.type, 'refund_credit')
    assert.equal(ledger.order_id, 'order_a')
    assert.ok((ledger.description as string).includes('review_refund'))
  })

  test('credits > 0 but buyer_id is null → skips refund (no crash)', async () => {
    // Edge case: orphan order with no buyer. Shouldn't happen but
    // defensive against weird data.
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ buyer_id: null, credits_applied: 15 }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: {},
    })
    await cancelOrderWithRefund(sb, 'order_a', 'test')
    assert.equal(calls.profileUpdates.length, 0)
    assert.equal(calls.creditTransactionInserts.length, 0)
  })
})

describe('cancelOrderWithRefund — final status update', () => {
  test('order status set to cancelled with admin_notes capturing the reason', async () => {
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder() },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'early_fraud_warning')
    assert.equal(calls.orderUpdates.length, 1)
    const upd = calls.orderUpdates[0]
    assert.equal(upd.id, 'order_a')
    assert.equal(upd.payload.status, 'cancelled')
    assert.ok((upd.payload.admin_notes as string).includes('early_fraud_warning'))
    assert.ok((upd.payload.admin_notes as string).startsWith('[auto-cancel]'))
  })

  test('SCOPE QUESTION: a paid order CAN be cancelled by this function', async () => {
    // Currently the guard only short-circuits on 'cancelled' or 'refunded'.
    // A paid order (e.g. EFW arrives after order shipped) goes through
    // and gets cancelled. This documents that behavior. If we ever want
    // to block this — e.g. require admin override to cancel a paid order
    // — the assertion below flips and forces a code change.
    const { sb, calls } = mockSupabase({
      orders: { order_a: baseOrder({ status: 'paid' }) },
      listings: { listing_a: { status: 'reserved', quantity_available: 0 } },
      profiles: { buyer_a: { balance: 50 } },
    })
    await cancelOrderWithRefund(sb, 'order_a', 'efw_late')
    assert.equal(calls.orderUpdates.length, 1, 'paid orders ARE cancellable today; revisit if needed')
  })
})
