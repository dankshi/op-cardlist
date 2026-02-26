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
  rating_avg: number
  rating_count: number
  total_sales: number
  created_at: string
  updated_at: string
}

// ============================================
// Marketplace Types
// ============================================

export type CardCondition =
  | 'near_mint'
  | 'lightly_played'
  | 'moderately_played'
  | 'heavily_played'
  | 'damaged'

export type ListingStatus = 'active' | 'sold' | 'reserved' | 'delisted'

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
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
  tcgplayer_product_id: number | null
  created_at: string
  updated_at: string
  // Joined fields
  seller?: Profile
}

export interface CartItem {
  id: string
  user_id: string
  listing_id: string
  quantity: number
  created_at: string
  updated_at: string
  // Joined fields
  listing?: Listing
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
  buyer_notes: string | null
  seller_notes: string | null
  paid_at: string | null
  shipped_at: string | null
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

export const CONDITION_LABELS: Record<CardCondition, string> = {
  near_mint: 'Near Mint',
  lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played',
  heavily_played: 'Heavily Played',
  damaged: 'Damaged',
}

export const CONDITION_SHORT: Record<CardCondition, string> = {
  near_mint: 'NM',
  lightly_played: 'LP',
  moderately_played: 'MP',
  heavily_played: 'HP',
  damaged: 'DMG',
}

export const CONDITION_COLORS: Record<CardCondition, string> = {
  near_mint: 'text-green-400 bg-green-400/10',
  lightly_played: 'text-yellow-400 bg-yellow-400/10',
  moderately_played: 'text-orange-400 bg-orange-400/10',
  heavily_played: 'text-red-400 bg-red-400/10',
  damaged: 'text-zinc-400 bg-zinc-400/10',
}
