import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const trackerId = request.nextUrl.searchParams.get('id')
  if (!trackerId) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('alt_manga_tracker_history')
    .select('*')
    .eq('tracker_id', trackerId)
    .order('recorded_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ history: data })
}
