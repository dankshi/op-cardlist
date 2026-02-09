import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Create client only if we have valid credentials
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

// Types for card_mappings table
export interface CardMappingRow {
  card_id: string; // e.g., "OP07-051_p2"
  tcgplayer_product_id: number;
  tcgplayer_url: string;
  tcgplayer_name: string;
  market_price: number | null;
  art_style: string | null; // 'manga', 'alternate', 'wanted', etc.
  submitted_by: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

export interface MappingSubmission {
  cardId: string;
  tcgProductId: number;
  tcgUrl: string;
  tcgName: string;
  price?: number | null;
  artStyle?: string | null;
  submittedBy?: string;
}
