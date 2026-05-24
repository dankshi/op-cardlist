import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

const ALLOWED_GRADERS = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cardId = searchParams.get('card_id')
  const userId = searchParams.get('user_id')
  // Optional variant filter: ?grading_company=PSA&grade=10 returns only
  // bids on that specific slab. ?grading_company=null (string "null")
  // returns only raw bids. Omitting both returns every variant.
  const gradingCompany = searchParams.get('grading_company')
  const grade = searchParams.get('grade')
  const limit = Math.min(Number(searchParams.get('limit') || 20), 50)

  const supabase = await createClient()

  let query = supabase
    .from('bids')
    .select('*, user:profiles(id, username, display_name, avatar_url, rating_avg)', { count: 'exact' })
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())

  if (cardId) query = query.eq('card_id', cardId)
  if (userId) query = query.eq('user_id', userId)
  if (gradingCompany === 'null') {
    query = query.is('grading_company', null)
  } else if (gradingCompany) {
    query = query.eq('grading_company', gradingCompany)
    if (grade) query = query.eq('grade', grade)
  }

  query = query.order('price', { ascending: false }).limit(limit)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bids: data, total: count })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { card_id, price, quantity, grading_company, grade, payment_intent_id } = body

  if (!card_id || !price || price <= 0) {
    return NextResponse.json({ error: 'card_id and a positive price are required' }, { status: 400 })
  }

  // Graded bids: both grading_company and grade must be set together.
  // Either-or is rejected at the DB layer too (CHECK constraint added in
  // migration 20260539), but we validate here so the client gets a clean
  // 400 instead of a generic 500.
  const hasCompany = grading_company != null && grading_company !== ''
  const hasGrade = grade != null && grade !== ''
  if (hasCompany !== hasGrade) {
    return NextResponse.json(
      { error: 'grading_company and grade must be provided together (or both omitted for a raw offer)' },
      { status: 400 },
    )
  }
  if (hasCompany && !ALLOWED_GRADERS.has(grading_company)) {
    return NextResponse.json(
      { error: `grading_company must be one of ${[...ALLOWED_GRADERS].join(', ')}` },
      { status: 400 },
    )
  }

  // Pre-auth flow: when the client provides a payment_intent_id, it
  // must point at a PaymentIntent created by /api/bids/intent for THIS
  // user and matching THIS amount/card. Without these checks a buyer
  // could attach someone else's intent (or an intent for a different
  // card) and create a bid backed by a charge they didn't authorize.
  //
  // Legacy bids (payment_intent_id omitted) still work but can't be
  // accepted via the new fast-capture path — Sell-into-offer falls
  // back to the /sell?card= routing for them.
  if (payment_intent_id) {
    try {
      const stripe = getStripe()
      const intent = await stripe.paymentIntents.retrieve(payment_intent_id)
      if (intent.metadata?.user_id !== user.id) {
        return NextResponse.json({ error: 'Payment intent owner mismatch' }, { status: 403 })
      }
      if (intent.metadata?.card_id !== card_id) {
        return NextResponse.json({ error: 'Payment intent card_id mismatch' }, { status: 400 })
      }
      if (intent.amount !== Math.round(price * 100)) {
        return NextResponse.json({ error: 'Payment intent amount does not match offer price' }, { status: 400 })
      }
      // After client confirms via Elements, the PI lands in
      // 'requires_capture'. Reject anything else so we never store a
      // bid backed by an unconfirmed (or already-captured/cancelled) PI.
      if (intent.status !== 'requires_capture') {
        return NextResponse.json(
          { error: `Payment intent is in state '${intent.status}' — expected 'requires_capture'` },
          { status: 400 },
        )
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to validate payment intent: ${err instanceof Error ? err.message : 'unknown'}` },
        { status: 400 },
      )
    }
  }

  const { data, error } = await supabase
    .from('bids')
    .insert({
      user_id: user.id,
      card_id,
      price,
      quantity: quantity || 1,
      condition_min: 'near_mint',
      grading_company: hasCompany ? grading_company : null,
      grade: hasGrade ? grade : null,
      stripe_payment_intent_id: payment_intent_id || null,
    })
    .select()
    .single()

  if (error) {
    // If the bid insert failed and we already had a PI confirmed,
    // cancel the PI so the buyer's pre-auth releases. Otherwise they'd
    // have a card hold with no bid backing it.
    if (payment_intent_id) {
      try { await getStripe().paymentIntents.cancel(payment_intent_id) }
      catch { /* best effort — the orphan PI will expire on its own in 24h */ }
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const bidId = searchParams.get('id')

  if (!bidId) {
    return NextResponse.json({ error: 'Missing bid id' }, { status: 400 })
  }

  // Read the bid first so we know whether to cancel a PaymentIntent.
  // Scoped to the user's own bids — RLS does the same enforcement but
  // we want the 404 vs 200 distinction visible to the client.
  const { data: existing, error: readError } = await supabase
    .from('bids')
    .select('id, status, stripe_payment_intent_id')
    .eq('id', bidId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (readError || !existing) {
    return NextResponse.json({ error: 'Bid not found' }, { status: 404 })
  }
  // Don't try to cancel a bid that's already terminal — the PI would
  // also be in a terminal state and Stripe returns a confusing 400.
  if (existing.status !== 'active') {
    return NextResponse.json({ success: true, alreadyTerminal: true })
  }

  // Cancel the bid row first so the user-facing state flips quickly even
  // if Stripe is slow. PI cancellation is best-effort — if it fails the
  // pre-auth hold drops off on its own at the 7-day mark.
  const { error: updateError } = await supabase
    .from('bids')
    .update({ status: 'cancelled' })
    .eq('id', bidId)
    .eq('user_id', user.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (existing.stripe_payment_intent_id) {
    try {
      await getStripe().paymentIntents.cancel(existing.stripe_payment_intent_id)
    } catch (err) {
      // Log but don't surface — the bid is already cancelled in our DB
      // and Stripe will release the hold on its own. Logging gives us a
      // trail to investigate if a buyer reports a stuck hold.
      console.error(`[bids DELETE] PI cancel failed for ${existing.stripe_payment_intent_id}:`, err)
    }
  }

  return NextResponse.json({ success: true })
}
