// ============================================
// Profile Types
// ============================================

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  is_seller: boolean
  seller_approved: boolean
  seller_applied_at: string | null
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
  is_admin: boolean
  rating_avg: number
  rating_count: number
  total_sales: number
  balance: number
  // Tier-aware pricing (migration 20260538). seller_tier drives the
  // marketplace % in calculatePayout(); seller_gmv is lifetime GMV.
  seller_tier: SellerTier
  seller_gmv: number
  shipping_street1: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
  shipping_email: string | null
  shipping_phone: string | null
  last_login_ip: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

// ============================================
// Marketplace Types
// ============================================

export type CardCondition = 'near_mint'

export type GradingCompany = 'PSA' | 'CGC' | 'BGS' | 'TAG'

export const GRADING_SCALES: Record<GradingCompany, string[]> = {
  PSA: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  CGC: ['10', '9.9', '9.8', '9.6', '9.4', '9.2', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.8', '1.5', '1', '0.5'],
  BGS: ['Black Label 10', '10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1'],
  TAG: ['Pristine 10', '10', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1'],
}

export type ListingStatus = 'active' | 'sold' | 'reserved' | 'delisted'

/** Seller pricing tier (migration 20260538). Mirrors TierId in src/lib/fees.ts. */
export type SellerTier = 'basic' | 'silver' | 'pearl' | 'gold' | 'diamond' | 'elite'

/** How a listed card reaches the buyer (migration 20260538). */
export type FulfillmentMethod = 'ship' | 'drop' | 'p2p'

export type OrderStatus =
  | 'pending_payment'
  | 'under_review'    // Stripe Radar or our risk checks flagged it; payouts held, seller can't ship yet
  | 'paid'
  | 'seller_shipped'
  | 'received'
  | 'exception_review' // authenticator flagged one or more items; resolution pending
  | 'authenticated'
  | 'shipped_to_buyer'
  | 'shipped'        // legacy — kept for old orders
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'disputed'

export type RiskLevel = 'normal' | 'elevated' | 'highest' | 'not_assessed'

export interface Listing {
  id: string
  seller_id: string
  card_id: string
  title: string
  description: string | null
  condition: CardCondition
  price: number
  quantity: number
  quantity_available: number
  language: string
  is_first_edition: boolean
  photo_urls: string[]
  status: ListingStatus
  grading_company: GradingCompany | null
  grade: string | null
  fulfillment_method: FulfillmentMethod
  tcgplayer_product_id: number | null
  created_at: string
  updated_at: string
  // Joined fields
  seller?: Profile
}


export interface Order {
  id: string
  buyer_id: string
  seller_id: string
  status: OrderStatus
  subtotal: number
  shipping_cost: number
  platform_fee: number
  // Per-component fee breakdown (migration 20260538). platform_fee stays
  // the rolled-up total (seller_fee + marketplace_fee); these expose the
  // split for seller-facing dashboards. Legacy orders default to 0.
  seller_fee: number
  marketplace_fee: number
  processing_fee: number
  seller_tier_at_sale: SellerTier | null
  total: number
  credits_applied: number
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
  shipping_address: ShippingAddress | null
  tracking_number: string | null
  tracking_carrier: string | null
  seller_tracking_number: string | null
  seller_tracking_carrier: string | null
  seller_label_url: string | null
  seller_label_cost: number | null
  outbound_label_url: string | null
  outbound_label_cost: number | null
  admin_notes: string | null
  buyer_notes: string | null
  seller_notes: string | null
  paid_at: string | null
  shipped_at: string | null
  received_at: string | null
  authenticated_at: string | null
  shipped_to_buyer_at: string | null
  delivered_at: string | null
  // Radar fraud-review fields (see supabase/migrations/20260543_radar_fraud_review.sql)
  stripe_review_id: string | null
  risk_score: number | null
  risk_level: RiskLevel | null
  review_opened_at: string | null
  review_closed_at: string | null
  review_reason: string | null
  review_closed_reason: string | null
  auto_flagged_reasons: string[]
  created_at: string
  updated_at: string
  // Joined fields
  buyer?: Profile
  seller?: Profile
  items?: OrderItem[]
}

export interface ShippingAddress {
  name: string
  line1: string
  line2?: string
  city: string
  state: string
  zip: string
  country: string
}

export type IntakeStatus = 'pending' | 'verified' | 'flagged' | 'resolved' | 'rejected'

// Fault-source buckets for an intake exception. Who/what is responsible:
// the courier, the seller's packaging, our own handling, or the item never
// arrived. (Replaced the older granular taxonomy — wrong_card/condition/
// counterfeit/etc. — which is now captured in the free-form context.)
export type IntakeIssueType =
  | 'courier_damage'
  | 'seller_packaging'
  | 'internal_handling'
  | 'missing_item'

export type IntakeResolutionStatus = 'open' | 'in_progress' | 'resolved' | 'escalated'

export type IntakeResolutionType =
  | 'replacement_requested'
  | 'partial_refund'
  | 'full_refund'
  | 'order_cancelled'
  | 'item_accepted'
  | 'new_item_created'
  | 'seller_contacted'

export type CreditTransactionType =
  | 'sale_earned'
  | 'purchase_spent'
  | 'cashout'
  | 'refund_credit'
  | 'admin_adjust'

export interface CreditTransaction {
  id: string
  user_id: string
  amount: number
  type: CreditTransactionType
  order_id: string | null
  description: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type PayoutMethod = 'standard' | 'instant'
export type CashoutStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export interface Cashout {
  id: string
  user_id: string
  amount: number
  fee: number
  total_debited: number
  method: PayoutMethod
  status: CashoutStatus
  stripe_transfer_id: string | null
  stripe_payout_id: string | null
  failure_reason: string | null
  credit_transaction_id: string | null
  requested_at: string
  completed_at: string | null
}

export type AuthDecision = 'pending' | 'authentic' | 'fake'
export type AuthCondition = 'near_mint' | 'exception'
export type ExceptionType = 'incorrect_product' | 'fake' | 'conditional' | 'physical_damage'

export interface OrderItem {
  id: string
  // Short unique label/QR code — migration 20260606. Not a FK.
  product_id: string
  order_id: string
  listing_id: string
  card_id: string
  card_name: string
  quantity: number
  unit_price: number
  condition: CardCondition
  snapshot_photo_url: string | null
  intake_status: IntakeStatus
  intake_verified_at: string | null
  intake_verified_by: string | null
  intake_notes: string | null
  is_damaged: boolean
  damage_notes: string | null
  // Auth flow Phase 2 — migration 20260603_authentication_flow.sql.
  auth_decision: AuthDecision
  auth_condition: AuthCondition | null
  exception_types: ExceptionType[]
  exception_details: Record<string, unknown>
  auth_decided_at: string | null
  auth_decided_by: string | null
  created_at: string
}

export interface IntakeIssue {
  id: string
  order_id: string
  order_item_id: string | null
  issue_type: IntakeIssueType
  description: string
  expected_card_name: string | null
  received_card_name: string | null
  expected_condition: string | null
  received_condition: string | null
  photo_urls: string[]
  resolution_status: IntakeResolutionStatus
  resolution_type: IntakeResolutionType | null
  resolution_notes: string | null
  resolved_at: string | null
  resolved_by: string | null
  seller_notified_at: string | null
  buyer_notified_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  // Joined fields
  order?: Order
  order_item?: OrderItem
  creator?: Profile
  resolver?: Profile
}

// ============================================
// Triage Types (Intake V2)
// ============================================

export type TriageType = 'no_order' | 'user_id'
export type TriageCardType = 'raw' | 'slab'
export type TriageResolvedAs = 'matched_order' | 'house_account'
export type ReceivedVia = 'tracking_scan' | 'pon_scan' | 'triage_resolution' | 'manual'

export interface TriagePackage {
  id: string
  // Human-readable package code: 'T-' + 8 Crockford chars — migration 20260607.
  triage_code: string
  triage_type: TriageType
  tracking_number: string | null
  seller_id: string | null
  card_type: TriageCardType | null
  cert_number: string | null
  nomi_input: string | null
  resolved_order_id: string | null
  resolved_as: TriageResolvedAs | null
  status: 'pending' | 'resolved'
  created_by: string
  resolved_by: string | null
  resolved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  seller?: Profile
  resolved_order?: Order
}

export type TrackingMatchType = 'exact' | 'multiple' | 'reused' | 'none'

export interface TrackingLookupResult {
  match: TrackingMatchType
  orders: Order[]
  seller_id?: string
}

export const HOUSE_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001'

export interface IntakeActivityLog {
  id: string
  order_id: string
  order_item_id: string | null
  intake_issue_id: string | null
  action: string
  details: Record<string, unknown>
  performed_by: string
  created_at: string
  // Joined fields
  performer?: Profile
}

export interface Review {
  id: string
  order_id: string
  reviewer_id: string
  seller_id: string
  rating: number
  comment: string | null
  created_at: string
  updated_at: string
  // Joined fields
  reviewer?: Profile
}

// ============================================
// Bids Types
// ============================================

export type BidStatus = 'active' | 'filled' | 'cancelled' | 'expired'

export interface Bid {
  id: string
  user_id: string
  card_id: string
  price: number
  quantity: number
  condition_min: CardCondition
  status: BidStatus
  expires_at: string
  created_at: string
  updated_at: string
  // Both NULL → bid is for the raw NM variant. Both set → bid is
  // specifically for that slab (e.g. PSA 10). DB constraint guarantees
  // the pair-consistent invariant (see migration 20260539).
  grading_company: GradingCompany | null
  grade: string | null
  // Stripe PaymentIntent (capture_method=manual) created when the buyer
  // placed the offer — buyer's card is reserved for `price` but not yet
  // charged. Captured on accept, cancelled on cancel/expire. NULL for
  // legacy bids created before migration 20260544 (those fall back to
  // the old /sell?card= sell-into-offer route).
  stripe_payment_intent_id: string | null
  // Joined fields
  user?: Profile
}

// ============================================
// Collection & Discovery Types
// ============================================

export interface CollectionItem {
  id: string
  user_id: string
  card_id: string
  quantity: number
  condition: CardCondition | null
  notes: string | null
  acquired_price: number | null
  acquired_date: string | null
  /** Grade, when the owned copy is slabbed. Both null = raw (condition). */
  grading_company: string | null
  grade: string | null
  /** Owner-set per-card current value, overriding market price in totals. */
  custom_value: number | null
  /** Serial / print number for numbered cards (e.g. "012/100"). */
  serial_number: string | null
  /** Grading cert number for slabbed cards (e.g. Beckett "0011590232"). */
  cert_number: string | null
  /** How this line entered the collection: a manual add or an auto-add from
   *  a delivered Nomi purchase. */
  acquired_via: 'manual' | 'purchase'
  /** Order that first created this line (provenance for purchase auto-adds). */
  order_id: string | null
  created_at: string
  updated_at: string
}

/** A single acquisition within a collection line (migration 20260620). A line's
 *  quantity + cost basis roll up from its lots; the parent collections row
 *  carries the synced aggregate. price_paid null = an unpriced ("loose") lot. */
export interface CollectionLot {
  id: string
  collection_id: string
  quantity: number
  price_paid: number | null
  acquired_date: string | null
  /** Capitalized cost beyond purchase price (grading fee + grading shipping),
   *  folded into the line's basis. NOT NULL DEFAULT 0 (migration 20260626). */
  grading_cost: number
  created_at: string
  updated_at: string
}

/** A disposition — closing collection lots via a sale (migration 20260621,
 *  docs/collection-pnl.md). `channel` 'nomi' rows are auto-recorded when an
 *  order authenticates; 'manual' rows are off-platform sales (Phase 2).
 *  `realized_gain` is a stored generated column (`net_proceeds − cost_basis`),
 *  null when the closed lots had no recorded cost basis. */
export interface CollectionSale {
  id: string
  user_id: string
  card_id: string
  collection_id: string | null
  order_id: string | null
  listing_id: string | null
  channel: 'nomi' | 'manual'
  quantity: number
  gross_proceeds: number | null
  fees: number
  net_proceeds: number | null
  cost_basis: number | null
  grading_company: string | null
  grade: string | null
  sold_at: string
  note: string | null
  created_at: string
  realized_gain: number | null
}

/** A logged collection adjustment (migration 20260626): a grade change, basis
 *  tweak, or note. */
export interface CollectionAdjustment {
  id: string
  user_id: string
  card_id: string
  collection_id: string | null
  type: 'grade' | 'basis' | 'note'
  from_grade: string | null
  to_grade: string | null
  /** Total capitalized cost of the play (grading fee + shipping). */
  amount: number | null
  /** Shipping slice of `amount` (null when none / non-grade). */
  shipping_cost: number | null
  happened_at: string
  note: string | null
  created_at: string
}

/** A normalized row from the `collection_activity` view (migration 20260626) —
 *  the unified buy/sell/grade feed for the per-card history + global ledger. */
export interface CollectionActivityRow {
  user_id: string
  card_id: string
  collection_id: string | null
  kind: 'buy' | 'sell' | 'grade' | 'basis' | 'note'
  happened_at: string
  quantity: number | null
  amount: number | null
  basis: number | null
  realized: number | null
  ref_order_id: string | null
  ref_listing_id: string | null
  from_grade: string | null
  to_grade: string | null
  note: string | null
  source_id: string
  /** Shipping slice of a grade event's `amount` (null otherwise). */
  shipping_cost: number | null
}

export interface WantListItem {
  id: string
  user_id: string
  card_id: string
  max_price: number | null
  min_condition: CardCondition
  priority: number
  notes: string | null
  notified_at: string | null
  created_at: string
}

export interface PriceAlert {
  id: string
  user_id: string
  card_id: string
  target_price: number
  alert_type: 'below' | 'above' | 'any_change'
  is_active: boolean
  last_triggered_at: string | null
  created_at: string
}

export interface Deck {
  id: string
  user_id: string
  name: string
  description: string | null
  leader_card_id: string | null
  is_public: boolean
  view_count: number
  created_at: string
  updated_at: string
  // Joined fields
  cards?: DeckCard[]
  user?: Profile
}

export interface DeckCard {
  id: string
  deck_id: string
  card_id: string
  quantity: number
  is_sideboard: boolean
  created_at: string
}

export interface Message {
  id: string
  order_id: string | null
  sender_id: string
  recipient_id: string
  content: string
  read_at: string | null
  created_at: string
  // Joined fields
  sender?: Profile
}

// ============================================
// Condition Display Helpers
// ============================================

export const CONDITION_LABEL = 'Near Mint'
export const CONDITION_SHORT_LABEL = 'NM'
export const CONDITION_COLOR = 'text-green-400 bg-green-400/10'

// ============================================
// Photo Slot Types
// ============================================

export const PHOTO_SLOTS = [
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'front_tl', label: 'Front Top-Left' },
  { key: 'front_tr', label: 'Front Top-Right' },
  { key: 'front_bl', label: 'Front Bottom-Left' },
  { key: 'front_br', label: 'Front Bottom-Right' },
  { key: 'back_tl', label: 'Back Top-Left' },
  { key: 'back_tr', label: 'Back Top-Right' },
  { key: 'back_bl', label: 'Back Bottom-Left' },
  { key: 'back_br', label: 'Back Bottom-Right' },
] as const

export type PhotoSlotKey = typeof PHOTO_SLOTS[number]['key']

export type PhotoSlotMap = Record<PhotoSlotKey, string | null>
