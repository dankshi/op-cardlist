import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_RESOLUTION_STATUSES = ['open', 'in_progress', 'resolved', 'escalated'] as const
const VALID_RESOLUTION_TYPES = [
  'replacement_requested', 'partial_refund', 'full_refund',
  'order_cancelled', 'item_accepted', 'new_item_created', 'seller_contacted',
] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ issueId: string }> }
) {
  const { issueId } = await params
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

  const { resolutionStatus, resolutionType, notes } = await request.json()

  // Fetch existing issue
  const { data: issue } = await supabase
    .from('intake_issues')
    .select('*')
    .eq('id', issueId)
    .single()

  if (!issue) {
    return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (resolutionStatus) {
    if (!VALID_RESOLUTION_STATUSES.includes(resolutionStatus)) {
      return NextResponse.json({ error: 'Invalid resolution status' }, { status: 400 })
    }
    update.resolution_status = resolutionStatus
  }

  if (resolutionType) {
    if (!VALID_RESOLUTION_TYPES.includes(resolutionType)) {
      return NextResponse.json({ error: 'Invalid resolution type' }, { status: 400 })
    }
    update.resolution_type = resolutionType
  }

  if (notes) {
    update.resolution_notes = notes
  }

  // If resolving, set resolved_at and resolved_by
  if (resolutionStatus === 'resolved') {
    update.resolved_at = new Date().toISOString()
    update.resolved_by = user.id

    // Also update the related order item's intake_status to 'resolved'
    if (issue.order_item_id) {
      await supabase
        .from('order_items')
        .update({ intake_status: 'resolved' })
        .eq('id', issue.order_item_id)
    }
  }

  const { error: updateError } = await supabase
    .from('intake_issues')
    .update(update)
    .eq('id', issueId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update issue' }, { status: 500 })
  }

  // Log the action
  await supabase.from('intake_activity_log').insert({
    order_id: issue.order_id,
    order_item_id: issue.order_item_id,
    intake_issue_id: issueId,
    action: resolutionStatus === 'resolved' ? 'issue_resolved' : 'issue_updated',
    details: {
      resolution_status: resolutionStatus,
      resolution_type: resolutionType,
      notes,
      previous_status: issue.resolution_status,
    },
    performed_by: user.id,
  })

  return NextResponse.json({ success: true })
}
