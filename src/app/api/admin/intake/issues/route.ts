import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const resolutionStatus = searchParams.get('resolutionStatus')
  const issueType = searchParams.get('issueType')
  const page = Number(searchParams.get('page') || '1')
  const limit = Number(searchParams.get('limit') || '20')
  const offset = (page - 1) * limit

  let query = supabase
    .from('intake_issues')
    .select(
      '*, order:orders!inner(id, status, buyer:profiles!orders_buyer_id_fkey(display_name), seller:profiles!orders_seller_id_fkey(display_name)), order_item:order_items(id, card_name, condition, snapshot_photo_url), creator:profiles!intake_issues_created_by_fkey(display_name), resolver:profiles!intake_issues_resolved_by_fkey(display_name)',
      { count: 'exact' }
    )

  if (resolutionStatus) {
    query = query.eq('resolution_status', resolutionStatus)
  }

  if (issueType) {
    query = query.eq('issue_type', issueType)
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data: issues, count, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch issues' }, { status: 500 })
  }

  return NextResponse.json({
    issues: issues || [],
    total: count || 0,
    page,
    limit,
  })
}
