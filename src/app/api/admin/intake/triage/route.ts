import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
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

  const { triageType, trackingNumber, sellerId, notes } = await request.json()

  if (!triageType || !['no_order', 'user_id'].includes(triageType)) {
    return NextResponse.json({ error: 'triageType must be no_order or user_id' }, { status: 400 })
  }

  if (triageType === 'user_id' && !sellerId) {
    return NextResponse.json({ error: 'sellerId is required for user_id triage' }, { status: 400 })
  }

  const { data: triagePackage, error } = await supabase
    .from('triage_packages')
    .insert({
      triage_type: triageType,
      tracking_number: trackingNumber || null,
      seller_id: triageType === 'user_id' ? sellerId : null,
      notes: notes || null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Triage create error:', error)
    return NextResponse.json({ error: 'Failed to create triage package' }, { status: 500 })
  }

  return NextResponse.json({ success: true, triagePackage })
}

// GET: Fetch triage packages (for the triage queue page and QR code lookups)
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
  const triageId = searchParams.get('id')
  const status = searchParams.get('status')

  // Single lookup by ID (for QR code scans)
  if (triageId) {
    const { data: pkg } = await supabase
      .from('triage_packages')
      .select('*, seller:profiles!triage_packages_seller_id_fkey(id, display_name, username)')
      .eq('id', triageId)
      .single()

    if (!pkg) {
      return NextResponse.json({ error: 'Triage package not found' }, { status: 404 })
    }
    return NextResponse.json({ triagePackage: pkg })
  }

  // List triage packages
  let query = supabase
    .from('triage_packages')
    .select('*, seller:profiles!triage_packages_seller_id_fkey(id, display_name, username)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: packages, error } = await query

  if (error) {
    console.error('Triage list error:', error)
    return NextResponse.json({ error: 'Failed to fetch triage packages' }, { status: 500 })
  }

  return NextResponse.json({ packages: packages || [] })
}
