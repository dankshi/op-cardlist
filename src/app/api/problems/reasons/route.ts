import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Preset reasons that are always available
const PRESET_REASONS = [
  'Product is already mapped',
  'Card not found on TCGPlayer',
  'Our image is wrong/missing',
  'Multiple variants exist',
];

// GET /api/problems/reasons - Get unique custom reasons (excluding presets)
export async function GET() {
  try {
    if (!supabase) {
      // Return empty if no DB, frontend will just use presets
      return NextResponse.json({ reasons: [] });
    }

    const { data, error } = await supabase
      .from('card_problems')
      .select('reason')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ reasons: [] });
    }

    // Get unique custom reasons (not in presets)
    const allReasons = data?.map(d => d.reason) || [];
    const customReasons = [...new Set(allReasons)]
      .filter(r => !PRESET_REASONS.includes(r))
      .slice(0, 10); // Limit to 10 most recent custom reasons

    return NextResponse.json({ reasons: customReasons });
  } catch (error) {
    console.error('Error fetching reasons:', error);
    return NextResponse.json({ reasons: [] });
  }
}
