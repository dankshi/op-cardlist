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

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'seller_shipped'
  | 'received'
  | 'authenticated'
  | 'shipped_to_buyer'
  | 'shipped'        // legacy — kept for old orders
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'disputed'

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
  total: number
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
  shipping_address: ShippingAddress | null
  tracking_number: string | null
  tracking_carrier: string | null
  seller_tracking_number: string | null
  seller_tracking_carrier: string | null
  seller_label_url: string | null
  seller_label_cost: number | null
  admin_notes: string | null
  buyer_notes: string | null
  seller_notes: string | null
  paid_at: string | null
  shipped_at: string | null
  received_at: string | null
  authenticated_at: string | null
  shipped_to_buyer_at: string | null
  delivered_at: string | null
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

export interface OrderItem {
  id: string
  order_id: string
  listing_id: string
  card_id: string
  card_name: string
  quantity: number
  unit_price: number
  condition: CardCondition
  snapshot_photo_url: string | null
  created_at: string
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
  created_at: string
  updated_at: string
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
