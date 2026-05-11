import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: cards, error } = await supabase
    .from('alt_manga_tracker')
    .select('*')
    .order('set_code', { ascending: true })
    .order('card_name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch listings grouped by tracker_id
  const trackerIds = cards?.map(c => c.id) || []
  let listings: any[] = []

  if (trackerIds.length > 0) {
    const { data: listingsData } = await supabase
      .from('alt_manga_listings')
      .select('*')
      .in('tracker_id', trackerIds)
      .order('listed_at', { ascending: false })

    listings = listingsData || []
  }

  // Group listings by tracker_id
  const listingsByTracker: Record<string, any[]> = {}
  for (const l of listings) {
    if (!listingsByTracker[l.tracker_id]) listingsByTracker[l.tracker_id] = []
    listingsByTracker[l.tracker_id].push(l)
  }

  return NextResponse.json({
    cards,
    listings: listingsByTracker,
    lastUpdated: cards?.[0]?.last_scraped_at,
  })
}
