import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  reserveListing,
  releaseReservation,
  finalizeSale,
  type ListingSnapshot,
} from './inventory';

const active = (qty: number): ListingSnapshot => ({ status: 'active', quantity_available: qty });
const reserved = (qty: number): ListingSnapshot => ({ status: 'reserved', quantity_available: qty });
const sold = (qty: number): ListingSnapshot => ({ status: 'sold', quantity_available: qty });
const delisted = (qty: number): ListingSnapshot => ({ status: 'delisted', quantity_available: qty });

describe('reserveListing', () => {
  test('single-qty listing: reserve the last unit → status flips to reserved', () => {
    const result = reserveListing(active(1), 1);
    assert.deepEqual(result, { nextQuantityAvailable: 0, nextStatus: 'reserved' });
  });

  test('multi-qty listing: partial reservation keeps status active', () => {
    const result = reserveListing(active(3), 1);
    assert.deepEqual(result, { nextQuantityAvailable: 2, nextStatus: 'active' });
  });

  test('multi-qty listing: reserving the last unit flips to reserved', () => {
    const result = reserveListing(active(3), 3);
    assert.deepEqual(result, { nextQuantityAvailable: 0, nextStatus: 'reserved' });
  });

  test('insufficient stock returns null (caller refuses order)', () => {
    assert.equal(reserveListing(active(1), 2), null);
    assert.equal(reserveListing(active(0), 1), null);
  });

  test('reserved listing with remaining stock can still accept reservations', () => {
    // Edge case: a multi-qty listing went reserved on the previous reserve,
    // then stock was released. New buyer can still grab from the leftover.
    const result = reserveListing(reserved(2), 1);
    assert.deepEqual(result, { nextQuantityAvailable: 1, nextStatus: 'active' });
  });

  test('sold listing rejects reservations', () => {
    assert.equal(reserveListing(sold(0), 1), null);
  });

  test('delisted listing rejects reservations', () => {
    assert.equal(reserveListing(delisted(1), 1), null);
  });

  test('zero or negative qty is rejected', () => {
    assert.equal(reserveListing(active(5), 0), null);
    assert.equal(reserveListing(active(5), -1), null);
  });
});

describe('releaseReservation', () => {
  test('release single-qty reservation restores stock + active', () => {
    const result = releaseReservation(reserved(0), 1);
    assert.deepEqual(result, { nextQuantityAvailable: 1, nextStatus: 'active' });
  });

  test('release on a still-active listing (multi-qty partial flow) restores stock', () => {
    const result = releaseReservation(active(2), 1);
    assert.deepEqual(result, { nextQuantityAvailable: 3, nextStatus: 'active' });
  });

  test('release is a no-op when listing already sold (returns null)', () => {
    // Webhook race: the order was finalized but a stale-cleanup also ran.
    // Don't restore stock — the seller no longer has the card.
    assert.equal(releaseReservation(sold(0), 1), null);
  });

  test('release is a no-op when listing was delisted by seller', () => {
    // Seller delisted the remainder mid-checkout; restoring would
    // resurrect inventory they no longer want to sell.
    assert.equal(releaseReservation(delisted(0), 1), null);
  });

  test('zero or negative qty is rejected', () => {
    assert.equal(releaseReservation(reserved(0), 0), null);
    assert.equal(releaseReservation(reserved(0), -1), null);
  });
});

describe('finalizeSale', () => {
  test('single-qty listing with no remaining stock → sold', () => {
    assert.equal(finalizeSale(reserved(0)), 'sold');
  });

  test('multi-qty listing with remaining stock → back to active', () => {
    assert.equal(finalizeSale(active(2)), 'active');
  });

  test('zero stock from any status finalizes to sold', () => {
    assert.equal(finalizeSale(active(0)), 'sold');
    assert.equal(finalizeSale(reserved(0)), 'sold');
  });
});

describe('end-to-end lifecycle', () => {
  test('single-qty: active → reserve → finalize → sold', () => {
    let snapshot: ListingSnapshot = active(1);

    const reserve = reserveListing(snapshot, 1);
    assert.ok(reserve, 'reservation succeeds');
    snapshot = { status: reserve.nextStatus, quantity_available: reserve.nextQuantityAvailable };
    assert.deepEqual(snapshot, { status: 'reserved', quantity_available: 0 });

    const finalStatus = finalizeSale(snapshot);
    assert.equal(finalStatus, 'sold');
  });

  test('single-qty: active → reserve → release → back to active', () => {
    let snapshot: ListingSnapshot = active(1);

    const reserve = reserveListing(snapshot, 1);
    assert.ok(reserve);
    snapshot = { status: reserve.nextStatus, quantity_available: reserve.nextQuantityAvailable };

    const release = releaseReservation(snapshot, 1);
    assert.ok(release);
    snapshot = { status: release.nextStatus, quantity_available: release.nextQuantityAvailable };
    assert.deepEqual(snapshot, { status: 'active', quantity_available: 1 });
  });

  test('single-qty: race — first buyer reserves, second is refused', () => {
    const snapshot: ListingSnapshot = active(1);

    const buyer1 = reserveListing(snapshot, 1);
    assert.ok(buyer1, 'buyer 1 wins');

    // Buyer 2 sees the post-buyer-1 snapshot (qty=0, reserved).
    const buyer2Snapshot: ListingSnapshot = {
      status: buyer1.nextStatus,
      quantity_available: buyer1.nextQuantityAvailable,
    };
    const buyer2 = reserveListing(buyer2Snapshot, 1);
    assert.equal(buyer2, null, 'buyer 2 is refused');
  });

  test('multi-qty (3): three buyers, first two reserve, third is refused', () => {
    let snapshot: ListingSnapshot = active(3);

    for (let i = 1; i <= 3; i++) {
      const reserve = reserveListing(snapshot, 1);
      if (i <= 3) {
        assert.ok(reserve, `buyer ${i} reserves`);
        snapshot = { status: reserve.nextStatus, quantity_available: reserve.nextQuantityAvailable };
      }
    }
    assert.deepEqual(snapshot, { status: 'reserved', quantity_available: 0 });

    // 4th buyer: refused
    const buyer4 = reserveListing(snapshot, 1);
    assert.equal(buyer4, null);
  });
});
