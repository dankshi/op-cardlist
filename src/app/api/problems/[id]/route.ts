import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE /api/problems/[id] - Delete a reported problem
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { id } = await params;
    const problemId = parseInt(id);

    if (isNaN(problemId)) {
      return NextResponse.json({ error: 'Invalid problem ID' }, { status: 400 });
    }

    const { error } = await supabase
      .from('card_problems')
      .delete()
      .eq('id', problemId);

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ error: 'Failed to delete problem', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Problem dismissed successfully',
    });
  } catch (error) {
    console.error('Error deleting problem:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
