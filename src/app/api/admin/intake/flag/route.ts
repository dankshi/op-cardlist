import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_ISSUE_TYPES = [
  'wrong_card', 'wrong_condition', 'missing_item', 'counterfeit',
  'damaged_in_transit', 'wrong_quantity', 'other',
] as const

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

  const {
    orderItemId,
    orderId,
    issueType,
    description,
    expectedCardName,
    receivedCardName,
    expectedCondition,
    receivedCondition,
    photoUrls,
  } = await request.json()

  if (!issueType || !description) {
    return NextResponse.json({ error: 'issueType and description are required' }, { status: 400 })
  }

  if (!VALID_ISSUE_TYPES.includes(issueType)) {
    return NextResponse.json({ error: 'Invalid issue type' }, { status: 400 })
  }

  // For missing_item, we only need orderId. For everything else, we need orderItemId
  let resolvedOrderId = orderId

  if (orderItemId) {
    const { data: item } = await supabase
      .from('order_items')
      .select('order_id, card_name, condition')
      .eq('id', orderItemId)
      .single()

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    resolvedOrderId = item.order_id

    // Update item intake status to flagged
    await supabase
      .from('order_items')
      .update({ intake_status: 'flagged' })
      .eq('id', orderItemId)
  }

  if (!resolvedOrderId) {
    return NextResponse.json({ error: 'orderId or orderItemId is required' }, { status: 400 })
  }

  // Create the intake issue
  const { data: issue, error: issueError } = await supabase
    .from('intake_issues')
    .insert({
      order_id: resolvedOrderId,
      order_item_id: orderItemId || null,
      issue_type: issueType,
      description,
      expected_card_name: expectedCardName || null,
      received_card_name: receivedCardName || null,
      expected_condition: expectedCondition || null,
      received_condition: receivedCondition || null,
      photo_urls: photoUrls || [],
      created_by: user.id,
    })
    .select()
    .single()

  if (issueError) {
    return NextResponse.json({ error: 'Failed to create issue' }, { status: 500 })
  }

  // Log the action
  await supabase.from('intake_activity_log').insert({
    order_id: resolvedOrderId,
    order_item_id: orderItemId || null,
    intake_issue_id: issue.id,
    action: 'issue_created',
    details: {
      issue_type: issueType,
      description,
      expected_card_name: expectedCardName,
      received_card_name: receivedCardName,
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true, issue })
}
