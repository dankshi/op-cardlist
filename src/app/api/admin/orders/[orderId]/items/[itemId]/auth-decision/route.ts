import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Records (or updates) the authenticator's per-item decision in the
 *  new auth-flow model. Replaces the old verify/flag pair with a
 *  single endpoint that captures: Authentic vs Fake, condition tier,
 *  and structured exception details.
 *
 *  See docs/authentication-flow.md for the data model + validation
 *  rules this endpoint enforces.
 *
 *  Idempotent: re-calling with the same body just overwrites. That's
 *  intentional — the authenticator can change their mind on an item
 *  any time before finalize-auth flips the order status. */

type Decision = 'authentic' | 'fake'
type Condition = 'near_mint' | 'exception'
type ExceptionType = 'incorrect_product' | 'fake' | 'conditional' | 'physical_damage'

interface IncorrectProductDetails {
  received_type: 'wrong_card' | 'slab' | 'raw'
  received_card_id?: string
  received_card_name?: string
}

interface ConditionalDetails {
  actual_condition: 'lightly_played' | 'heavily_played'
  damage_areas?: string[]
}

interface PhysicalDamageDetails {
  attribution: 'courier' | 'nomi' | 'seller'
  notes?: string
}

interface FakeDetails {
  disposition: 'return_to_seller' | 'destroyed'
}

interface ExceptionInput {
  type: ExceptionType
  details: IncorrectProductDetails | ConditionalDetails | PhysicalDamageDetails | FakeDetails
}

interface AuthDecisionBody {
  decision: Decision
  condition?: Condition
  exceptions?: ExceptionInput[]
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string; itemId: string }> }
) {
  const { orderId, itemId } = await params
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

  let body: AuthDecisionBody
  try {
    body = (await request.json()) as AuthDecisionBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── shape validation ──────────────────────────────────────────
  // Each branch enforces the matching CHECK in
  // 20260603_authentication_flow.sql so the server catches a bad
  // payload before the DB rejects it with a less helpful message.
  const validation = validateDecisionShape(body)
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 400 })
  }

  // ── order/item ownership + status ─────────────────────────────
  // Item must belong to this order, and the order must be in
  // `received` (the only state where authentication makes sense).
  // Locked here rather than enforced via DB constraint to give a
  // friendlier error than a foreign-key failure.
  const { data: orderItem } = await supabase
    .from('order_items')
    .select('id, order_id, order:orders!inner(id, status)')
    .eq('id', itemId)
    .eq('order_id', orderId)
    .single()

  if (!orderItem) {
    return NextResponse.json({ error: 'Order item not found' }, { status: 404 })
  }

  // The embedded order shape Supabase returns can be array-or-object
  // depending on FK detection; normalize.
  const orderRow = Array.isArray(orderItem.order) ? orderItem.order[0] : orderItem.order
  if (!orderRow || (orderRow.status !== 'received' && orderRow.status !== 'exception_review')) {
    return NextResponse.json({
      error: `Cannot record decision: order is in '${orderRow?.status}'. Authentication only valid from 'received' or 'exception_review'.`,
    }, { status: 400 })
  }

  // ── build the row update ──────────────────────────────────────
  const exceptionTypes = (body.exceptions || []).map(e => e.type)
  // Discriminated JSONB — keyed by exception_type for compactness +
  // forward-compat. App code reads e.g. `details.incorrect_product`.
  const exceptionDetails: Record<string, unknown> = {}
  for (const ex of body.exceptions || []) {
    exceptionDetails[ex.type] = ex.details
  }

  const adminSupabase = getSupabaseAdmin()
  const { error: updateError } = await adminSupabase
    .from('order_items')
    .update({
      auth_decision: body.decision,
      auth_condition: body.condition ?? null,
      exception_types: exceptionTypes,
      exception_details: exceptionDetails,
      auth_decided_at: new Date().toISOString(),
      auth_decided_by: user.id,
    })
    .eq('id', itemId)

  if (updateError) {
    return NextResponse.json({
      error: `Failed to record decision: ${updateError.message}`,
    }, { status: 500 })
  }

  // Audit trail — mirrors the pattern used by verify/flag so the
  // existing intake activity log surfaces the new decisions in the
  // same timeline view.
  await adminSupabase.from('intake_activity_log').insert({
    order_id: orderId,
    order_item_id: itemId,
    action: `auth_decision:${body.decision}${body.condition ? `:${body.condition}` : ''}`,
    details: {
      decision: body.decision,
      condition: body.condition,
      exception_types: exceptionTypes,
      exception_details: exceptionDetails,
    },
    performed_by: user.id,
  })

  return NextResponse.json({
    ok: true,
    decision: body.decision,
    condition: body.condition ?? null,
    exception_types: exceptionTypes,
  })
}

/** Validates the decision/condition/exceptions trio matches one of the
 *  four shapes the DB CHECK constraint allows. Returns an error
 *  message string, or null when valid. */
function validateDecisionShape(body: AuthDecisionBody): string | null {
  if (body.decision !== 'authentic' && body.decision !== 'fake') {
    return `Invalid decision '${body.decision}'. Must be 'authentic' or 'fake'.`
  }

  const exceptions = body.exceptions || []

  if (body.decision === 'fake') {
    // Fake is exclusive — it carries exactly one exception, of type
    // 'fake', with a disposition. No other exceptions can co-occur.
    if (body.condition !== undefined) {
      return "Fake decisions must not include a condition."
    }
    if (exceptions.length !== 1 || exceptions[0].type !== 'fake') {
      return "Fake decisions require exactly one exception of type 'fake' with a disposition."
    }
    const det = exceptions[0].details as FakeDetails
    if (det.disposition !== 'return_to_seller' && det.disposition !== 'destroyed') {
      return "Fake disposition must be 'return_to_seller' or 'destroyed'."
    }
    return null
  }

  // decision === 'authentic'
  if (body.condition !== 'near_mint' && body.condition !== 'exception') {
    return "Authentic decisions require condition='near_mint' or 'exception'."
  }

  if (body.condition === 'near_mint') {
    if (exceptions.length > 0) {
      return "Near-mint decisions must not include exceptions."
    }
    return null
  }

  // condition === 'exception'
  if (exceptions.length === 0) {
    return "Exception condition requires at least one exception entry."
  }
  // 'fake' as an exception type is reserved for the top-level fake
  // decision — can't combine with authentic.
  for (const ex of exceptions) {
    if (ex.type === 'fake') {
      return "Exception type 'fake' can only be used with decision='fake' at the top level.";
    }
    const detailValidation = validateExceptionDetails(ex)
    if (detailValidation) return detailValidation
  }

  return null
}

function validateExceptionDetails(ex: ExceptionInput): string | null {
  switch (ex.type) {
    case 'incorrect_product': {
      const d = ex.details as IncorrectProductDetails
      if (!['wrong_card', 'slab', 'raw'].includes(d.received_type)) {
        return "incorrect_product.received_type must be one of: wrong_card, slab, raw."
      }
      if (d.received_type === 'wrong_card' && !d.received_card_id) {
        return "incorrect_product with received_type='wrong_card' requires received_card_id."
      }
      return null
    }
    case 'conditional': {
      const d = ex.details as ConditionalDetails
      if (!['lightly_played', 'heavily_played'].includes(d.actual_condition)) {
        return "conditional.actual_condition must be 'lightly_played' or 'heavily_played'."
      }
      return null
    }
    case 'physical_damage': {
      const d = ex.details as PhysicalDamageDetails
      if (!['courier', 'nomi', 'seller'].includes(d.attribution)) {
        return "physical_damage.attribution must be 'courier', 'nomi', or 'seller'."
      }
      return null
    }
    default:
      return `Unknown exception type '${ex.type}'.`
  }
}
