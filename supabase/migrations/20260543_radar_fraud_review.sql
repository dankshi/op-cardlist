-- ============================================
-- RADAR FRAUD REVIEW — Part 1: enum value
-- Adds the `under_review` order state for charges that Stripe Radar
-- (or our own marketplace risk checks) flag for manual review.
--
-- Split from the rest of the radar migration because PostgreSQL won't
-- let you reference a newly-added enum value (e.g. in a CHECK or partial
-- index predicate) in the same transaction. The columns + partial index
-- + profile fields live in 20260545_radar_fraud_review_part2.sql.
--
-- See docs/stripe-radar.md for the full design.
-- ============================================

-- Inserted right after pending_payment so the natural flow is
-- pending_payment → under_review → paid → seller_shipped → ...
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'under_review' AFTER 'pending_payment';
