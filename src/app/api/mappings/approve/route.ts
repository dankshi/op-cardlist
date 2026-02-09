import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/mappings/approve - Approve pending mappings (admin only)
export async function POST(request: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const adminKey = request.headers.get('x-admin-key');

    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const cardIds: string[] = body.cardIds || [];

    if (cardIds.length === 0) {
      // Approve all pending
      const { data, error } = await supabase
        .from('card_mappings')
        .update({ approved: true })
        .eq('approved', false)
        .select();

      if (error) {
        return NextResponse.json({ error: 'Failed to approve mappings' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        approved: data?.length || 0,
        message: `Approved ${data?.length || 0} pending mapping(s)`
      });
    }

    // Approve specific cards
    const { data, error } = await supabase
      .from('card_mappings')
      .update({ approved: true })
      .in('card_id', cardIds)
      .select();

    if (error) {
      return NextResponse.json({ error: 'Failed to approve mappings' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      approved: data?.length || 0,
      message: `Approved ${data?.length || 0} mapping(s)`
    });
  } catch (error) {
    console.error('Error approving mappings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/mappings/approve - Get pending mappings count (admin only)
export async function GET(request: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const adminKey = request.headers.get('x-admin-key');

    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { count, error } = await supabase
      .from('card_mappings')
      .select('*', { count: 'exact', head: true })
      .eq('approved', false);

    if (error) {
      return NextResponse.json({ error: 'Failed to count pending' }, { status: 500 });
    }

    return NextResponse.json({ pendingCount: count || 0 });
  } catch (error) {
    console.error('Error counting pending:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
