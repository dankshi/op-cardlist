import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/problems - Report a problem with a card
export async function POST(request: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await request.json();
    const { cardId, reason, reportedBy } = body;

    if (!cardId || !reason) {
      return NextResponse.json({ error: 'Card ID and reason are required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('card_problems')
      .insert({
        card_id: cardId,
        reason: reason,
        reported_by: reportedBy || 'anonymous',
      });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to save problem report', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Problem reported successfully',
    });
  } catch (error) {
    console.error('Error reporting problem:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/problems - Get all reported problems
export async function GET() {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { data, error } = await supabase
      .from('card_problems')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to fetch problems' }, { status: 500 });
    }

    return NextResponse.json({ problems: data || [] });
  } catch (error) {
    console.error('Error fetching problems:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
