import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { fetchProductSales } from '@/lib/scraper/tcgplayer-sales'

export const dynamic = 'force-dynamic'

/** Admin on-demand "scrape this card" — pulls fresh sales for a single card's
 *  TCGplayer product right now (same parse/write path as the cron) and logs it
 *  to scraper_runs. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const cardId = typeof body.cardId === 'string' ? body.cardId.trim().toUpperCase() : ''
  if (!cardId) return NextResponse.json({ error: 'cardId is required' }, { status: 400 })

  const admin = getSupabaseAdmin()

  const { data: map } = await admin
    .from('card_tcgplayer_mapping')
    .select('tcgplayer_product_id')
    .eq('card_id', cardId)
    .maybeSingle()
  if (!map?.tcgplayer_product_id) {
    return NextResponse.json({ error: `No TCGplayer mapping for ${cardId}.` }, { status: 404 })
  }
  const productId = map.tcgplayer_product_id as number

  const { data: ck } = await admin.from('scraper_settings').select('value').eq('key', 'tcgplayer_auth_cookie').maybeSingle()
  const cookie = (ck?.value as string | undefined) ?? process.env.TCGPLAYER_AUTH_COOKIE

  const { data: run } = await admin
    .from('scraper_runs')
    .insert({ job_type: 'card', trigger: 'manual', triggered_by: user.id, scope: { card_id: cardId, product_id: productId }, status: 'running' })
    .select('id')
    .single()
  const runId = run?.id as number | undefined

  try {
    const sales = await fetchProductSales(productId, cookie)

    if (sales.length > 0) {
      const rows = sales.map(s => ({
        tcgplayer_product_id: productId,
        sold_at: s.date,
        price: s.price,
        condition: s.condition,
        variant: s.variant,
        language: s.language,
        listing_type: s.listingType,
        shipping_price: s.shippingPrice,
        custom_listing_id: s.customListingId,
        quantity: s.quantity,
      }))
      await admin.from('card_sales').upsert(rows, {
        onConflict: 'tcgplayer_product_id,sold_at,price,condition,variant,language',
        ignoreDuplicates: true,
      })
    }

    // latestsales returns newest-first.
    const latest = sales[0] ?? null
    const patch: Record<string, unknown> = { sales_scraped_at: new Date().toISOString() }
    if (latest) {
      patch.last_sold_price = latest.price
      patch.last_sold_date = latest.date
    }
    await admin.from('tcgplayer_products').update(patch).eq('product_id', productId)

    if (runId) {
      await admin.from('scraper_runs').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        stats: { salesStored: sales.length, productId, cards: [{ cardId, productId, sales: sales.length }] },
      }).eq('id', runId)
    }

    return NextResponse.json({
      ok: true,
      cardId,
      productId,
      salesStored: sales.length,
      lastSold: latest ? { price: latest.price, date: latest.date } : null,
    })
  } catch (err) {
    if (runId) {
      await admin.from('scraper_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', runId)
    }
    return NextResponse.json({ error: 'Scrape failed.' }, { status: 500 })
  }
}
