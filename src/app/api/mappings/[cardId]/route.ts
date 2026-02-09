import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE /api/mappings/[cardId] - Delete a card mapping (revert)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> }
) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { cardId } = await params;

    const { error } = await supabase
      .from('card_mappings')
      .delete()
      .eq('card_id', cardId);

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to delete mapping', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `Deleted mapping for ${cardId}` });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
