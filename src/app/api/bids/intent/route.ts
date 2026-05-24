import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe'

const ALLOWED_GRADERS = new Set(['PSA', 'CGC', 'BGS', 'TAG'])

/** POST /api/bids/intent
 *
 *  First step of the new pre-auth bid flow. Creates a Stripe
 *  PaymentIntent with capture_method='manual' so the buyer's card is
 *  reserved (but not charged) for the offer amount, then returns the
 *  client_secret so the client can confirm the card via Stripe Elements.
 *
 *  Once Elements completes confirmation, the client calls POST /api/bids
 *  with the returned payment_intent_id to finalize the bid row. We
 *  intentionally don't create the bid row here — if the buyer abandons
 *  card entry, the PaymentIntent expires (24h) and never becomes a bid.
 *
 *  See designs/offer-flow.md for the architectural rationale.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { card_id, price, grading_company, grade } = body

  if (!card_id || typeof price !== 'number' || price <= 0) {
    return NextResponse.json(
      { error: 'card_id and a positive numeric price are required' },
      { status: 400 },
    )
  }

  // Mirror the validation in POST /api/bids — graded company + grade
  // must be supplied together. We validate at intent time so a graded
  // offer never makes it past card confirmation only to fail at bid
  // creation.
  const hasCompany = grading_company != null && grading_company !== ''
  const hasGrade = grade != null && grade !== ''
  if (hasCompany !== hasGrade) {
    return NextResponse.json(
      { error: 'grading_company and grade must be provided together' },
      { status: 400 },
    )
  }
  if (hasCompany && !ALLOWED_GRADERS.has(grading_company)) {
    return NextResponse.json(
      { error: `grading_company must be one of ${[...ALLOWED_GRADERS].join(', ')}` },
      { status: 400 },
    )
  }

  // Lazy-create Stripe Customer for this user so future offers can
  // reuse saved payment methods.
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, display_name')
    .eq('id', user.id)
    .single()

  const stripe = getStripe()
  let customerId = profile?.stripe_customer_id ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: profile?.display_name ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
    // Persist via service-role client because profiles RLS gates
    // self-edits to specific columns.
    const admin = getSupabaseAdmin()
    await admin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
  }

  // Pre-authorization: capture_method='manual' tells Stripe to verify
  // the card and hold funds without actually moving them. We capture
  // later when a seller accepts the offer.
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(price * 100),
    currency: 'usd',
    capture_method: 'manual',
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    // Save the payment method on the Customer so the buyer's next
    // offer can reuse it without re-entering card details.
    setup_future_usage: 'off_session',
    metadata: {
      user_id: user.id,
      card_id,
      variant: hasCompany ? `${grading_company}:${grade}` : 'raw',
      kind: 'bid_pre_auth',
    },
  })

  return NextResponse.json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
  })
}
