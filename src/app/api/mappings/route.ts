import { NextResponse } from 'next/server';
import { supabase, type MappingSubmission } from '@/lib/supabase';

// GET /api/mappings - Get all mappings (approved only for public, all for admin)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeUnapproved = searchParams.get('all') === 'true';
    const adminKey = request.headers.get('x-admin-key');

    // Check if admin key matches (for viewing unapproved)
    const isAdmin = adminKey === process.env.ADMIN_KEY;

    let query = supabase.from('card_mappings').select('*');

    // Only show approved unless admin requests all
    if (!isAdmin || !includeUnapproved) {
      query = query.eq('approved', true);
    }

    const { data, error } = await query.order('updated_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 });
    }

    // Convert to our format
    const mappings: Record<string, {
      tcgProductId: number;
      tcgUrl: string;
      tcgName: string;
      price: number | null;
      artStyle: string | null;
      approved: boolean;
    }> = {};

    data?.forEach(row => {
      mappings[row.card_id] = {
        tcgProductId: row.tcgplayer_product_id,
        tcgUrl: row.tcgplayer_url,
        tcgName: row.tcgplayer_name,
        price: row.market_price,
        artStyle: row.art_style,
        approved: row.approved,
      };
    });

    return NextResponse.json({ mappings, count: data?.length || 0 });
  } catch (error) {
    console.error('Error fetching mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/mappings - Submit new mapping(s)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const submissions: MappingSubmission[] = Array.isArray(body) ? body : [body];
    const submittedBy = body.submittedBy || 'anonymous';
    const adminKey = request.headers.get('x-admin-key');
    const isAdmin = adminKey === process.env.ADMIN_KEY;

    if (submissions.length === 0) {
      return NextResponse.json({ error: 'No mappings provided' }, { status: 400 });
    }

    const rows = submissions.map(sub => ({
      card_id: sub.cardId,
      tcgplayer_product_id: sub.tcgProductId,
      tcgplayer_url: sub.tcgUrl,
      tcgplayer_name: sub.tcgName,
      market_price: sub.price ?? null,
      art_style: sub.artStyle ?? null,
      submitted_by: submittedBy,
      approved: isAdmin, // Auto-approve if admin
    }));

    // Upsert to handle updates to existing mappings
    const { data, error } = await supabase
      .from('card_mappings')
      .upsert(rows, { onConflict: 'card_id' })
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to save mappings', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      saved: data?.length || 0,
      approved: isAdmin,
      message: isAdmin
        ? `Saved and approved ${data?.length} mapping(s)`
        : `Submitted ${data?.length} mapping(s) for approval`
    });
  } catch (error) {
    console.error('Error saving mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
